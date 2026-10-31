import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import type { Activity, Tail, Tool } from './types.js'

/** The last `bytes` of a file, split into whole lines. Transcripts reach gigabytes: never read them whole. */
export function readTailLines(path: string, bytes = 96 * 1024): string[] {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    // The first line is cut in half unless the read began at the top.
    if (start > 0) lines.shift()
    return lines.filter((line) => line.trim() !== '')
  } finally {
    closeSync(fd)
  }
}

/** The first `bytes` of a file, as whole lines: where the title and working folder usually are. */
export function readHeadLines(path: string, bytes = 32 * 1024): string[] {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    const lines = buffer.subarray(0, read).toString('utf8').split('\n')
    if (read === bytes) lines.pop()
    return lines.filter((line) => line.trim() !== '')
  } finally {
    closeSync(fd)
  }
}

type Json = Record<string, unknown>

function parse(line: string): Json | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? (value as Json) : null
  } catch {
    return null
  }
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function short(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/** A tool call as the office shows it: where the agent goes, and a few words on the bubble. */
export function describeTool(name: string, input: Json): Tool {
  const path = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path)
  let activity: Activity = 'tool'
  let target: string | null = null
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      activity = 'edit'
      target = path ? basename(path) : null
      break
    case 'Read':
      activity = 'read'
      target = path ? basename(path) : null
      break
    case 'Grep':
    case 'Glob':
    case 'LS':
      activity = 'read'
      target = str(input.pattern) ? short(String(input.pattern), 40) : path ? basename(path) : null
      break
    case 'Bash': {
      const command = str(input.command) ?? ''
      activity = /\b(test|vitest|jest|pytest|spec|swift test|go test|cargo test)\b/.test(command) ? 'test' : 'run'
      target = str(input.description) ?? (command ? short(command, 50) : null)
      break
    }
    case 'WebFetch':
    case 'WebSearch': {
      activity = 'web'
      const url = str(input.url)
      target = url ? safeHost(url) : str(input.query) ? short(String(input.query), 40) : null
      break
    }
    case 'Task':
    case 'Agent':
      activity = 'delegate'
      target = str(input.description) ?? str(input.subagent_type)
      break
    case 'SendMessage':
      activity = 'message'
      target = str(input.to) ?? str(input.recipient)
      break
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      activity = 'plan'
      break
    default:
      target = path ? basename(path) : null
  }
  return { name, target, activity }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return short(url, 40)
  }
}

/** Reads what an agent is doing from the last lines of its transcript. */
export function readTail(lines: string[]): Tail {
  const tail: Tail = {
    step: null,
    tool: null,
    lastText: null,
    title: null,
    cwd: null,
    model: null,
    permissionMode: null,
    contextTokens: null,
    lastEventAt: null,
    history: [],
    sent: {},
  }
  for (const line of lines) {
    const entry = parse(line)
    if (!entry) continue
    const type = String(entry.type ?? '').toLowerCase()
    const at = str(entry.timestamp)
    if (at) {
      const time = Date.parse(at)
      if (!Number.isNaN(time)) tail.lastEventAt = time
    }
    tail.cwd = str(entry.cwd) ?? tail.cwd
    if (type === 'ai-title') tail.title = str(entry.aiTitle) ?? tail.title
    if (type === 'permission-mode') tail.permissionMode = str(entry.permissionMode) ?? str(entry.mode) ?? tail.permissionMode

    const message = (entry.message ?? null) as Json | null
    if (type === 'assistant' && message) {
      tail.model = str(message.model) ?? tail.model
      const usage = message.usage as Json | undefined
      if (usage) {
        tail.contextTokens = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
      }
      const content = Array.isArray(message.content) ? (message.content as Json[]) : []
      for (const part of content) {
        if (part.type === 'text' && str(part.text)) tail.lastText = short(String(part.text), 140)
        if (part.type === 'tool_use') {
          tail.tool = describeTool(String(part.name ?? 'tool'), (part.input ?? {}) as Json)
          // A message to a teammate (not a broadcast to everyone).
          if (part.name === 'SendMessage' && tail.tool.target && tail.tool.target !== '*') {
            const sent = (tail.sent[tail.tool.target] ??= { count: 0, at: 0 })
            sent.count++
            if (at) sent.at = Math.max(sent.at, Date.parse(at) || 0)
          }
          if (at) tail.history.push({ at: Date.parse(at), tool: tail.tool })
          tail.step = 'calledTool'
        }
      }
      if (message.stop_reason === 'end_turn') {
        tail.step = 'finished'
        tail.tool = null
      } else if (!content.some((part) => part.type === 'tool_use') && tail.step !== 'calledTool') {
        tail.step = 'awaitingModel'
      }
    } else if (type === 'user' && message) {
      // A prompt or a tool's result: the model has the turn.
      tail.step = 'awaitingModel'
    } else if (type === 'api-request') {
      tail.step = 'awaitingModel'
    }
  }
  // Only the latest few: the office streams every agent's timeline on each change.
  tail.history = tail.history.filter((step) => !Number.isNaN(step.at)).slice(-HISTORY)
  return tail
}

/** How many tool calls an agent's timeline keeps. */
export const HISTORY = 12
