import { statSync } from 'node:fs'
import { readRange } from './conversation.js'
import type { Tokens } from './types.js'

/**
 * Tokens an agent used, from the `usage` of its replies. A transcript can be gigabytes, so a file
 * is counted from at most its last `FIRST_READ` bytes when first seen (then the count says it's
 * partial), and afterwards only from what was appended. Claude Code repeats a reply's usage on
 * each of its parts: a reply counts once, by its message id.
 */

const FIRST_READ = 1024 * 1024
/** At most this much new text is counted per scan; the rest waits for the next. */
const STEP = 4 * 1024 * 1024
const SEEN = 400

type Json = Record<string, unknown>
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

interface Count {
  offset: number
  input: number
  output: number
  partial: boolean
  /** Recent message ids, so a reply split over lines counts once. */
  seen: string[]
}

/** Adds the usage in Claude Code transcript lines to a count. */
export function addUsage(count: { input: number; output: number; seen: string[] }, lines: string[]): void {
  for (const line of lines) {
    // Most lines have no usage: skip them without parsing.
    if (!line.includes('"usage"')) continue
    let entry: Json
    try {
      entry = JSON.parse(line) as Json
    } catch {
      continue
    }
    const message = entry.message as Json | undefined
    if (entry.type !== 'assistant' || !message?.usage) continue
    const id = typeof message.id === 'string' ? message.id : null
    if (id) {
      if (count.seen.includes(id)) continue
      count.seen.push(id)
      if (count.seen.length > SEEN) count.seen.shift()
    }
    const usage = message.usage as Json
    count.input += num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
    count.output += num(usage.output_tokens)
  }
}

const counts = new Map<string, Count>()

/** The tokens a Claude Code transcript shows, kept up to date as it grows. */
export function claudeTokens(path: string): Tokens | null {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    return null
  }
  let count = counts.get(path)
  if (!count || size < count.offset) {
    // New to AgentHQ (or rewritten): start from its last part.
    const start = Math.max(0, size - FIRST_READ)
    count = { offset: start, input: 0, output: 0, partial: start > 0, seen: [] }
    counts.set(path, count)
    if (counts.size > 5000) counts.delete(counts.keys().next().value!)
  }
  if (size > count.offset) {
    try {
      const range = readRange(path, count.offset, Math.min(size, count.offset + STEP))
      addUsage(count, range.lines)
      // A range that began mid-line skipped to the next line; a half-written last line waits.
      count.offset = range.end > count.offset ? range.end : count.offset
    } catch {
      // Gone between the stat and the read.
    }
  }
  return { input: count.input, output: count.output, partial: count.partial }
}

/** A sum of tokens (null when nobody counted any). */
export function sumTokens(all: (Tokens | null | undefined)[]): Tokens | null {
  const known = all.filter((tokens): tokens is Tokens => !!tokens)
  if (known.length === 0) return null
  return {
    input: known.reduce((sum, tokens) => sum + tokens.input, 0),
    output: known.reduce((sum, tokens) => sum + tokens.output, 0),
    partial: known.some((tokens) => tokens.partial),
  }
}
