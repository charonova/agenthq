import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexState, describeItem, discoverCodexOffices, readCodexTail, readThread } from '../src/codex.js'

// Lines shaped like Codex's own rollouts (compact JSON), with made-up content.
const NOW = Date.parse('2026-10-30T12:00:00.000Z')
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()
const line = (value: object) => JSON.stringify(value)
const meta = (id: string, cwd: string, extra: object = {}) =>
  line({ timestamp: at(900), type: 'session_meta', payload: { id, cwd, cli_version: '0.120.0', source: 'vscode', ...extra } })
const event = (ago: number, payload: object) => line({ timestamp: at(ago), type: 'event_msg', payload })
const asked = (ago: number, text: string) => event(ago, { type: 'user_message', message: text, images: [] })
const item = (ago: number, value: object) =>
  event(ago, { type: 'item_completed', completed_at_ms: NOW - ago * 1000, item: value })

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agenthq-codex-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function rollout(name: string, lines: string[], secondsAgo: number) {
  const dir = join(home, 'sessions', '2026', '10', '30')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `rollout-2026-10-30T11-00-00-${name}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  const time = (NOW - secondsAgo * 1000) / 1000
  utimesSync(path, time, time)
}

describe('Codex threads', () => {
  it('reads who a thread is: its folder, its parent, and what was asked first', () => {
    expect(readThread([meta('t1', '/Users/me/Code/api'), asked(800, 'Fix the flaky login test please')])).toEqual({
      id: 't1',
      cwd: '/Users/me/Code/api',
      parentId: null,
      agentName: null,
      title: 'Fix the flaky login test please',
    })
    const sub = readThread([
      meta('t2', '/Users/me/Code/api', { source: { subagent: { other: 'guardian' } }, parent_thread_id: 't1' }),
    ])
    expect(sub).toMatchObject({ parentId: 't1', agentName: 'guardian' })
  })

  it('names finished actions by where the agent goes', () => {
    expect(
      describeItem({
        type: 'CommandExecution',
        command: 'sed -n 1,80p src/a.ts',
        parsed_cmd: [{ type: 'read', cmd: 'sed', name: 'a.ts', path: 'src/a.ts' }],
      }),
    ).toEqual({ name: 'Read', target: 'a.ts', activity: 'read' })
    expect(
      describeItem({
        type: 'CommandExecution',
        command: 'rg login',
        parsed_cmd: [{ type: 'search', cmd: 'rg', query: 'login', path: '.' }],
      }),
    ).toMatchObject({ activity: 'read', target: 'login' })
    expect(
      describeItem({
        type: 'CommandExecution',
        command: 'pnpm vitest run',
        parsed_cmd: [{ type: 'unknown', cmd: 'pnpm vitest run' }],
      }),
    ).toMatchObject({ activity: 'test' })
    expect(describeItem({ type: 'FileChange', changes: { '/Users/me/Code/api/src/login.ts': {} } })).toEqual({
      name: 'Edit',
      target: 'login.ts',
      activity: 'edit',
    })
    expect(describeItem({ type: 'Extension', kind: 'web.search', query: 'oauth pkce' })).toMatchObject({ activity: 'web' })
    expect(describeItem({ type: 'Reasoning' })).toBeNull()
  })

  it('follows turns: working, asking you, done', () => {
    const working = readCodexTail([event(30, { type: 'task_started' }), item(5, { type: 'FileChange', changes: { 'a.ts': {} } })])
    expect(codexState(working, NOW - 5000, NOW)).toEqual({ state: 'working', rest: null, activity: 'edit' })
    expect(working.history).toHaveLength(1)

    const asking = readCodexTail([
      event(30, { type: 'task_started' }),
      line({
        timestamp: at(20),
        type: 'response_item',
        payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'c1', arguments: '{}' },
      }),
    ])
    expect(codexState(asking, NOW - 20_000, NOW).state).toBe('waiting')

    const done = readCodexTail([
      event(30, { type: 'task_started' }),
      event(5, { type: 'task_complete', last_agent_message: 'Fixed it.' }),
    ])
    expect(codexState(done, NOW - 5000, NOW)).toMatchObject({ state: 'done' })
    expect(done.lastText).toBe('Fixed it.')
    expect(codexState(done, NOW - 5000, NOW + 5 * 60_000)).toMatchObject({ state: 'idle', rest: 'coffee' })
  })

  it('makes an office per main thread, with its sub-agents as staff', () => {
    rollout(
      'main',
      [meta('main', '/Users/me/Code/api'), asked(800, 'Ship the login fix'), event(60, { type: 'task_started' })],
      10,
    )
    rollout(
      'guard',
      [
        meta('guard', '/Users/me/Code/api', { source: { subagent: { other: 'guardian' } }, parent_thread_id: 'main' }),
        event(20, { type: 'task_started' }),
      ],
      5,
    )
    rollout('old', [meta('old', '/Users/me/Code/old'), event(7200, { type: 'task_complete' })], 7200)
    const offices = discoverCodexOffices({ home, now: NOW })
    expect(offices).toHaveLength(1)
    expect(offices[0]).toMatchObject({
      kind: 'codex',
      project: 'api',
      title: 'Ship the login fix',
      manager: { name: 'Codex', state: 'working' },
    })
    expect(offices[0]!.staff.map((agent) => [agent.name, agent.state])).toEqual([['guardian', 'working']])
  })

  it('takes thread names from Codex’s own index, the latest rename first', () => {
    rollout('main', [meta('main', '/Users/me/Code/api'), event(60, { type: 'task_started' })], 10)
    writeFileSync(
      join(home, 'session_index.jsonl'),
      [
        line({ id: 'main', thread_name: 'Login fix', updated_at: at(600) }),
        line({ id: 'main', thread_name: 'Login fix, take 2', updated_at: at(60) }),
      ].join('\n'),
    )
    expect(discoverCodexOffices({ home, now: NOW })[0]!.title).toBe('Login fix, take 2')
  })
})

describe('Codex tokens', () => {
  it('takes Codex’s own running total for the thread', () => {
    const tail = readCodexTail([
      '{"timestamp":"2026-10-31T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12000,"cached_input_tokens":9000,"output_tokens":800,"total_tokens":12800},"last_token_usage":{"input_tokens":3000,"output_tokens":200}}}}',
      '{"timestamp":"2026-10-31T10:01:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15500,"cached_input_tokens":11000,"output_tokens":950,"total_tokens":16450},"last_token_usage":{"input_tokens":3500,"output_tokens":150}}}}',
    ])
    expect(tail.tokens).toEqual({ input: 15500, output: 950, partial: false })
    expect(tail.contextTokens).toBe(3500)
  })
})
