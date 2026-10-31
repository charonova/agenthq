import { describeItem } from './codex.js'
import { readRange } from './conversation.js'
import { describeTool } from './tail.js'
import type { Tool } from './types.js'

/**
 * A session's last hours, for replaying as a time-lapse: each agent's steps (a prompt, a tool
 * call, a reply, the end of a turn) with their times. Transcripts are read backwards a page at a
 * time, only as far as the window reaches (and never more than `MAX_BYTES` per agent).
 */

export interface ReplayStep {
  at: number
  kind: 'prompt' | 'tool' | 'reply' | 'done'
  tool?: Tool
}

export interface ReplayAgent {
  id: string
  steps: ReplayStep[]
}

export interface Replay {
  sessionId: string
  from: number
  to: number
  agents: ReplayAgent[]
}

const PAGE = 256 * 1024
const MAX_BYTES = 8 * 1024 * 1024

type Json = Record<string, unknown>

function parse(line: string): Json | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? (value as Json) : null
  } catch {
    return null
  }
}

const timeOf = (entry: Json): number | null => {
  const text = typeof entry.timestamp === 'string' ? entry.timestamp : null
  const time = text ? Date.parse(text) : NaN
  return Number.isNaN(time) ? null : time
}

/** The lines written since `since` (or as many as `maxBytes` holds), oldest first. */
export function readRecent(path: string, since: number, maxBytes = MAX_BYTES): string[] {
  const size = readRange(path, 0, 0).size
  const pages: string[][] = []
  let end = size
  let read = 0
  while (end > 0 && read < maxBytes) {
    const range = readRange(path, Math.max(0, end - PAGE), end)
    // One line longer than a page: step over it.
    if (range.lines.length === 0) {
      end = Math.max(0, end - PAGE)
      read += PAGE
      continue
    }
    pages.unshift(range.lines)
    read += end - range.start
    end = range.start
    const first = range.lines.map(parse).find((entry) => entry && timeOf(entry) !== null)
    if (first && timeOf(first)! < since) break
  }
  return pages.flat()
}

/** Claude Code or Codex transcript lines as replay steps, from `since` on. */
export function replaySteps(lines: string[], kind: 'claude' | 'codex', since = 0): ReplayStep[] {
  const steps: ReplayStep[] = []
  for (const line of lines) {
    const entry = parse(line)
    if (!entry) continue
    const at = timeOf(entry)
    if (at === null || at < since) continue
    if (kind === 'codex') {
      const payload = (entry.payload ?? {}) as Json
      if (entry.type !== 'event_msg') continue
      if (payload.type === 'task_started') steps.push({ at, kind: 'prompt' })
      else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') steps.push({ at, kind: 'done' })
      else if (payload.type === 'item_completed') {
        const tool = describeItem((payload.item ?? {}) as Json)
        if (tool) steps.push({ at, kind: 'tool', tool })
      }
      continue
    }
    const message = (entry.message ?? null) as Json | null
    if (!message) continue
    if (entry.type === 'user') steps.push({ at, kind: 'prompt' })
    else if (entry.type === 'assistant') {
      const content = Array.isArray(message.content) ? (message.content as Json[]) : []
      const call = content.find((part) => part.type === 'tool_use')
      if (call) steps.push({ at, kind: 'tool', tool: describeTool(String(call.name ?? 'tool'), (call.input ?? {}) as Json) })
      else if (message.stop_reason === 'end_turn') steps.push({ at, kind: 'done' })
      else steps.push({ at, kind: 'reply' })
    }
  }
  // Only what changes what the office shows: the same step again adds nothing.
  return steps.filter((step, i) => {
    const before = steps[i - 1]
    return !before || before.kind !== step.kind || before.tool?.target !== step.tool?.target || step.kind === 'tool'
  })
}

/** A session's last `hours`, for its agents. */
export function readReplay(
  sessionId: string,
  kind: 'claude' | 'codex',
  agents: { id: string; transcript: string }[],
  hours: number,
  now = Date.now(),
): Replay {
  const from = now - hours * 60 * 60_000
  return {
    sessionId,
    from,
    to: now,
    agents: agents.map((agent) => {
      try {
        return { id: agent.id, steps: replaySteps(readRecent(agent.transcript, from), kind, from) }
      } catch {
        return { id: agent.id, steps: [] }
      }
    }),
  }
}
