import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeMessages, codexMessages, readConversation, readRange } from '../src/conversation.js'

// Lines shaped like the real transcripts (compact JSON), with made-up content.
const line = (value: object) => JSON.stringify(value)
const at = '2026-10-30T12:00:00.000Z'
const assistant = (uuid: string, content: object[]) =>
  line({ type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content } })
const user = (uuid: string, content: unknown, extra: object = {}) =>
  line({ type: 'user', uuid, timestamp: at, message: { role: 'user', content }, ...extra })

describe('Claude Code conversations', () => {
  it('reads prompts, replies, and tool calls with their results', () => {
    const messages = claudeMessages([
      user('u1', 'add a CSV export'),
      assistant('a1', [
        { type: 'text', text: 'Running the tests first.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'pnpm test', description: 'Run the tests' } },
      ]),
      user('u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passed', is_error: false }]),
    ])
    expect(messages.map((m) => m.kind)).toEqual(['user', 'assistant', 'tool'])
    const tool = messages[2] as Extract<(typeof messages)[number], { kind: 'tool' }>
    expect(tool.tool).toMatchObject({ name: 'Bash', activity: 'test', target: 'Run the tests' })
    expect(tool.input).toBe('pnpm test')
    expect(tool.result).toEqual({ text: '12 passed', isError: false })
  })

  it('shows messages from teammates as theirs, and hides what Claude Code adds by itself', () => {
    const messages = claudeMessages([
      user('u1', '<teammate-message teammate_id="qa" color="green" summary="Tests pass">All 12 pass on main.</teammate-message>'),
      user('u2', '<system-reminder>internal</system-reminder>', { isMeta: true }),
      user('u3', '<task-notification><task-id>t1</task-id><summary>Build finished</summary></task-notification>'),
      user('u4', 'Summary of the earlier conversation', { isCompactSummary: true }),
    ])
    expect(messages).toEqual([
      {
        kind: 'agent',
        id: 'u1',
        at: Date.parse(at),
        from: 'qa',
        color: 'green',
        summary: 'Tests pass',
        text: 'All 12 pass on main.',
      },
      { kind: 'notice', id: 'u3', at: Date.parse(at), text: 'Background task: Build finished' },
      { kind: 'notice', id: 'u4', at: Date.parse(at), text: 'The conversation was compacted: older messages were summarized.' },
    ])
  })

  it('sends a result on its own when its call is on another page', () => {
    const messages = claudeMessages([
      user('u1', [{ type: 'tool_result', tool_use_id: 'toolu_9', content: [{ type: 'text', text: 'done' }] }]),
    ])
    expect(messages).toEqual([
      { kind: 'result', id: 'u1-0', at: Date.parse(at), toolId: 'toolu_9', result: { text: 'done', isError: false } },
    ])
  })

  it('cuts very long texts', () => {
    const [message] = claudeMessages([assistant('a1', [{ type: 'text', text: 'x'.repeat(10_000) }])])
    expect((message as { text: string }).text.length).toBeLessThan(6100)
  })
})

describe('Codex conversations', () => {
  it('reads messages and finished actions, and skips what Codex hands the model', () => {
    const event = (payload: object) => line({ timestamp: at, type: 'event_msg', payload })
    const messages = codexMessages([
      line({
        timestamp: at,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }],
        },
      }),
      line({
        timestamp: at,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the login' }] },
      }),
      event({
        type: 'item_completed',
        item: {
          type: 'CommandExecution',
          id: 'c1',
          command: 'pnpm test',
          aggregated_output: '1 failed',
          exit_code: 1,
          parsed_cmd: [{ type: 'unknown', cmd: 'pnpm test' }],
        },
      }),
      line({
        timestamp: at,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed.' }] },
      }),
      event({ type: 'task_complete' }),
    ])
    expect(messages.map((m) => m.kind)).toEqual(['user', 'tool', 'assistant', 'notice'])
    expect(messages[1]).toMatchObject({ input: 'pnpm test', result: { text: '1 failed', isError: true } })
  })
})

describe('pages', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agenthq-conv-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads whole lines only, and pages back to the beginning', () => {
    const path = join(dir, 't.jsonl')
    const lines = Array.from({ length: 4000 }, (_, i) => user(`u${i}`, `message number ${i}`))
    writeFileSync(path, lines.join('\n') + '\n')
    const newest = readConversation(path, 'claude')
    expect(newest.messages.at(-1)).toMatchObject({ text: 'message number 3999' })
    const range = readRange(path, 1000, 5000)
    expect(range.lines.every((l) => l.startsWith('{') && l.endsWith('}'))).toBe(true)
    // Page back until the beginning: every message comes exactly once.
    let seen = newest.messages.length
    let cursor = newest.start
    while (cursor > 0) {
      const older = readConversation(path, 'claude', { before: cursor })
      seen += older.messages.length
      cursor = older.start
    }
    expect(seen).toBe(4000)
  })

  it('pages past an entry larger than a page', () => {
    const path = join(dir, 't.jsonl')
    const big = user('big', 'y'.repeat(600 * 1024))
    writeFileSync(path, [user('u0', 'before it'), big, user('u2', 'after it')].join('\n') + '\n')
    const newest = readConversation(path, 'claude')
    expect(newest.messages).toMatchObject([{ text: 'after it' }])
    const middle = readConversation(path, 'claude', { before: newest.start })
    expect(middle.messages).toMatchObject([{ id: 'big' }])
    expect(middle.start).toBeLessThan(newest.start)
    const first = readConversation(path, 'claude', { before: middle.start })
    expect(first).toMatchObject({ start: 0, messages: [{ text: 'before it' }] })
  })

  it('returns only what was written since, and waits for half-written lines', () => {
    const path = join(dir, 't.jsonl')
    writeFileSync(path, user('u1', 'first') + '\n')
    const first = readConversation(path, 'claude')
    writeFileSync(path, user('u1', 'first') + '\n' + user('u2', 'second') + '\n' + '{"type":"user","mess')
    const next = readConversation(path, 'claude', { since: first.end })
    expect(next.messages).toMatchObject([{ text: 'second' }])
    expect(readConversation(path, 'claude', { since: next.end }).messages).toEqual([])
  })
})
