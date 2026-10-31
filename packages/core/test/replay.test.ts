import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readRecent, replaySteps } from '../src/replay.js'

// Lines shaped like the real ones (compact JSON), with made-up content.
const at = (minute: number) => new Date(Date.UTC(2026, 9, 31, 10, minute)).toISOString()
const prompt = (minute: number) =>
  JSON.stringify({ type: 'user', timestamp: at(minute), message: { role: 'user', content: 'go' } })
const call = (minute: number, name: string, input: object) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at(minute),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] },
  })
const end = (minute: number) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at(minute),
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  })

describe('replaying a session', () => {
  it('turns Claude Code lines into steps, from the window’s start', () => {
    const steps = replaySteps(
      [prompt(1), call(2, 'Read', { file_path: '/a/README.md' }), call(3, 'Bash', { command: 'pnpm test' }), end(4), '{ half'],
      'claude',
      Date.parse(at(2)),
    )
    expect(steps.map((step) => [step.kind, step.tool?.target ?? null])).toEqual([
      ['tool', 'README.md'],
      ['tool', 'pnpm test'],
      ['done', null],
    ])
  })

  it('turns Codex events into steps', () => {
    const event = (minute: number, payload: object) => JSON.stringify({ timestamp: at(minute), type: 'event_msg', payload })
    const steps = replaySteps(
      [
        event(1, { type: 'task_started' }),
        event(2, { type: 'item_completed', item: { type: 'FileChange', changes: { 'src/a.ts': {} } } }),
        event(3, { type: 'task_complete' }),
      ],
      'codex',
    )
    expect(steps.map((step) => step.kind)).toEqual(['prompt', 'tool', 'done'])
  })

  it('reads backwards only as far as the window reaches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenthq-replay-'))
    const path = join(dir, 'a.jsonl')
    // An hour of old lines, then the last ten minutes.
    const old = Array.from({ length: 3000 }, (_, i) => call(0, 'Read', { file_path: `/old/${i}.md`, pad: 'x'.repeat(200) }))
    writeFileSync(path, [...old, prompt(50), call(55, 'Edit', { file_path: '/a/b.ts' }), end(59)].join('\n') + '\n')
    const lines = readRecent(path, Date.parse(at(45)))
    expect(lines.length).toBeLessThan(old.length)
    expect(lines.at(-1)).toContain('end_turn')
    expect(replaySteps(lines, 'claude', Date.parse(at(45))).map((step) => step.kind)).toEqual(['prompt', 'tool', 'done'])
    rmSync(dir, { recursive: true, force: true })
  })
})
