import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { describeItem } from './codex.js'
import { sources } from './sources.js'
import { describeTool } from './tail.js'
import type { Tool } from './types.js'

/**
 * A conversation, read a page at a time: transcripts reach gigabytes, so the page shows the
 * newest part first, older pages as you scroll up, and new lines as they're written. Pages are
 * byte ranges of the file, always cut at line breaks.
 */

/** One entry of a conversation, the same for Claude Code and Codex. */
export type Message =
  | { kind: 'user'; id: string; at: number | null; text: string }
  | { kind: 'assistant'; id: string; at: number | null; text: string }
  | { kind: 'tool'; id: string; at: number | null; tool: Tool; input: string | null; result: ToolResult | null }
  /** From another agent: a teammate's message, a helper's report, another session. */
  | { kind: 'agent'; id: string; at: number | null; from: string; color: string | null; summary: string | null; text: string }
  /** Something that happened: a background task finished, the conversation was compacted, a command ran. */
  | { kind: 'notice'; id: string; at: number | null; text: string }
  /** A tool's result whose call is on another page (written after it was read, or before this page): the page puts it on its call. */
  | { kind: 'result'; id: string; at: number | null; toolId: string; result: ToolResult }

export interface ToolResult {
  text: string
  isError: boolean
}

export interface ConversationPage {
  messages: Message[]
  /** Byte offset where this page starts: ask for `before` it to load older messages (0: the beginning). */
  start: number
  /** Byte offset where this page ends: ask for `since` it to get new messages. */
  end: number
}

/** How much a page reads, and how long a text may be before it's cut. */
export const PAGE_BYTES = 192 * 1024
/** An entry larger than this (a pasted image, a huge output) is skipped rather than read. */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_TEXT = 6000
const MAX_TOOL_TEXT = 2500

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${(text.length - max).toLocaleString('en')} more characters)` : text
}

/** Reads whole lines from a byte range: a range that starts mid-line skips to the next line; a half-written last line waits. */
export function readRange(path: string, from: number, to: number): { lines: string[]; start: number; end: number; size: number } {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const end = Math.min(to, size)
    const start = Math.max(0, Math.min(from, end))
    const buffer = Buffer.alloc(end - start)
    readSync(fd, buffer, 0, buffer.length, start)
    let first = 0
    if (start > 0) {
      // Unless the byte before is a line break, the range began mid-line: skip to the next line.
      const before = Buffer.alloc(1)
      readSync(fd, before, 0, 1, start - 1)
      if (before[0] !== 0x0a) {
        const newline = buffer.indexOf(0x0a)
        first = newline < 0 ? buffer.length : newline + 1
      }
    }
    const lastNewline = buffer.lastIndexOf(0x0a)
    const usableEnd = lastNewline < first ? first : lastNewline + 1
    const lines = buffer
      .subarray(first, usableEnd)
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
    return { lines, start: start + first, end: start + usableEnd, size }
  } finally {
    closeSync(fd)
  }
}

/** A page of a conversation: the newest one, the one `before` an offset, or what came `since` one. */
export function readConversation(
  path: string,
  kind: 'claude' | 'codex',
  page: { before?: number; since?: number } = {},
): ConversationPage {
  let range: ReturnType<typeof readRange>
  if (page.since !== undefined) {
    range = readRange(path, page.since, Number.MAX_SAFE_INTEGER)
    // Never more than a page at once: a burst of output catches up over a few reads.
    if (range.end - range.start > PAGE_BYTES * 4) range = readRange(path, range.end - PAGE_BYTES, range.end)
  } else {
    const end = page.before ?? Number.MAX_SAFE_INTEGER
    const size = readRange(path, 0, 0).size
    const to = Math.min(end, size)
    range = readRange(path, Math.max(0, to - PAGE_BYTES), to)
    if (range.lines.length === 0 && range.start === to && to > 0) {
      // One entry is larger than a page: take it whole, or step over it when it's huge.
      const begin = lineStart(path, to - 1)
      if (to - begin <= MAX_ENTRY_BYTES) range = readRange(path, begin, to)
      else {
        const skipped: Message = { kind: 'notice', id: `skipped-${begin}`, at: null, text: 'A very large entry was skipped' }
        return { messages: [skipped], start: begin, end: to }
      }
    }
  }
  const messages = sources[kind].messages(range.lines)
  return { messages, start: range.start, end: range.end }
}

/** Where the line holding the byte before `before` starts: just after the previous line break, or 0. */
function lineStart(path: string, before: number): number {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(64 * 1024)
    let position = before
    while (position > 0) {
      const from = Math.max(0, position - chunk.length)
      const read = readSync(fd, chunk, 0, position - from, from)
      const newline = chunk.subarray(0, read).lastIndexOf(0x0a)
      if (newline >= 0) return from + newline + 1
      position = from
    }
    return 0
  } finally {
    closeSync(fd)
  }
}

type Json = Record<string, unknown>
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

function parse(line: string): Json | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? (value as Json) : null
  } catch {
    return null
  }
}

const timeOf = (entry: Json): number | null => {
  const text = str(entry.timestamp)
  if (!text) return null
  const time = Date.parse(text)
  return Number.isNaN(time) ? null : time
}

function inputText(input: unknown): string | null {
  if (input === undefined || input === null) return null
  // A command reads best as itself.
  const command = typeof input === 'object' ? (input as Json).command : undefined
  const text = typeof input === 'string' ? input : typeof command === 'string' ? command : JSON.stringify(input, null, 2)
  return cut(text, MAX_TOOL_TEXT)
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as Json
        return p.type === 'text' ? String(p.text ?? '') : p.type === 'image' ? '[image]' : ''
      })
      .join('\n')
  }
  return content === undefined || content === null ? '' : JSON.stringify(content)
}

/** `<teammate-message teammate_id="qa" color="green" summary="…">text</teammate-message>` and its relatives. */
const fromAgent = /^<(teammate-message|agent-message|cross-session-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>)?\s*$/
const attribute = (attributes: string, name: string) => attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null

function userText(id: string, at: number | null, text: string, entry: Json): Message | null {
  const trimmed = text.trim()
  const agent = trimmed.match(fromAgent)
  if (agent) {
    const [, tag, attributes, body] = agent
    const from = attribute(attributes!, 'teammate_id') ?? attribute(attributes!, 'from') ?? attribute(attributes!, 'name') ?? tag!
    return {
      kind: 'agent',
      id,
      at,
      from,
      color: attribute(attributes!, 'color'),
      summary: attribute(attributes!, 'summary'),
      text: cut(body!.trim(), MAX_TEXT),
    }
  }
  if (entry.isCompactSummary)
    return { kind: 'notice', id, at, text: 'The conversation was compacted: older messages were summarized.' }
  if (trimmed.startsWith('<task-notification')) {
    const summary = trimmed.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim()
    return { kind: 'notice', id, at, text: summary ? `Background task: ${cut(summary, 300)}` : 'A background task finished' }
  }
  const command = trimmed.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (command) return { kind: 'notice', id, at, text: `Ran ${command.trim()}` }
  // Lines Claude Code adds by itself (reminders, local command output) aren't part of the conversation.
  if (entry.isMeta || trimmed.startsWith('<local-command') || trimmed.startsWith('<system-reminder')) return null
  return { kind: 'user', id, at, text: cut(trimmed, MAX_TEXT) }
}

/** Claude Code's transcript lines as a conversation: prompts, replies, tool calls with their results, other agents. */
export function claudeMessages(lines: string[]): Message[] {
  const messages: Message[] = []
  const tools = new Map<string, Extract<Message, { kind: 'tool' }>>()
  lines.forEach((line, n) => {
    const entry = parse(line)
    if (!entry) return
    const type = String(entry.type ?? '').toLowerCase()
    const message = (entry.message ?? null) as Json | null
    const at = timeOf(entry)
    const baseId = str(entry.uuid) ?? `line-${n}`
    if (type === 'assistant' && message) {
      const content = Array.isArray(message.content) ? (message.content as Json[]) : []
      content.forEach((part, i) => {
        if (part.type === 'text' && str(part.text)) {
          messages.push({ kind: 'assistant', id: `${baseId}-${i}`, at, text: cut(String(part.text), MAX_TEXT) })
        } else if (part.type === 'tool_use') {
          const toolId = str(part.id) ?? `${baseId}-${i}`
          const tool: Extract<Message, { kind: 'tool' }> = {
            kind: 'tool',
            id: toolId,
            at,
            tool: describeTool(String(part.name ?? 'tool'), (part.input ?? {}) as Json),
            input: inputText(part.input),
            result: null,
          }
          tools.set(toolId, tool)
          messages.push(tool)
        }
      })
    } else if (type === 'user' && message) {
      const content = message.content
      if (typeof content === 'string') {
        const parsed = userText(baseId, at, content, entry)
        if (parsed) messages.push(parsed)
        return
      }
      if (!Array.isArray(content)) return
      ;(content as Json[]).forEach((part, i) => {
        if (part.type === 'tool_result') {
          const toolId = String(part.tool_use_id ?? '')
          const result = { text: cut(resultText(part.content), MAX_TOOL_TEXT), isError: part.is_error === true }
          const tool = tools.get(toolId)
          if (tool) tool.result = result
          else if (toolId) messages.push({ kind: 'result', id: `${baseId}-${i}`, at, toolId, result })
        } else if (part.type === 'text' && str(part.text)) {
          const parsed = userText(`${baseId}-${i}`, at, String(part.text), entry)
          if (parsed) messages.push(parsed)
        } else if (part.type === 'image') {
          messages.push({ kind: 'user', id: `${baseId}-${i}`, at, text: '[image]' })
        }
      })
    }
  })
  return messages
}

/** Codex's rollout lines as a conversation: messages, and finished actions with their output. */
export function codexMessages(lines: string[]): Message[] {
  const messages: Message[] = []
  lines.forEach((line, n) => {
    const entry = parse(line)
    if (!entry) return
    const payload = (entry.payload ?? {}) as Json
    const at = timeOf(entry)
    const id = `line-${n}`
    if (entry.type === 'response_item' && payload.type === 'message') {
      const content = Array.isArray(payload.content) ? (payload.content as Json[]) : []
      const text = content
        .map((part) => str(part.text))
        .filter(Boolean)
        .join('\n')
        .trim()
      // Codex hands the model its environment and instructions as user messages: not the person's words.
      if (!text || text.startsWith('<')) return
      if (payload.role === 'user') messages.push({ kind: 'user', id, at, text: cut(text, MAX_TEXT) })
      else if (payload.role === 'assistant') messages.push({ kind: 'assistant', id, at, text: cut(text, MAX_TEXT) })
    } else if (entry.type === 'event_msg' && payload.type === 'item_completed') {
      const item = (payload.item ?? {}) as Json
      const tool = describeItem(item)
      if (!tool) return
      const input =
        item.type === 'CommandExecution'
          ? str(item.command)
          : item.type === 'FileChange'
            ? Object.keys((item.changes ?? {}) as Json).join('\n')
            : inputText(item.arguments ?? item.query ?? null)
      const output =
        item.type === 'CommandExecution'
          ? str(item.aggregated_output)
          : item.type === 'McpToolCall'
            ? resultText(item.result)
            : null
      const exit = typeof item.exit_code === 'number' ? item.exit_code : 0
      messages.push({
        kind: 'tool',
        id: str(item.id) ?? id,
        at,
        tool,
        input: input ? cut(input, MAX_TOOL_TEXT) : null,
        result: output !== null ? { text: cut(output, MAX_TOOL_TEXT), isError: exit !== 0 } : null,
      })
    } else if (entry.type === 'event_msg' && payload.type === 'task_complete') {
      messages.push({ kind: 'notice', id, at, text: 'Turn finished' })
    }
  })
  return messages
}
