import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverOffices } from '../src/office.js'
import { stateOf, timing } from '../src/state.js'
import { describeTool, readTail, readTailLines } from '../src/tail.js'

// Lines shaped like Claude Code's own transcripts (compact JSON, one per line), with made-up content.
const NOW = Date.parse('2026-10-30T12:00:00.000Z')
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()
const line = (value: object) => JSON.stringify(value)

const title = (text: string) => line({ type: 'ai-title', aiTitle: text, sessionId: 's1' })
const prompt = (cwd: string, ago: number) =>
  line({ type: 'user', cwd, message: { role: 'user', content: 'build it' }, timestamp: at(ago) })
const toolUse = (cwd: string, ago: number, name: string, input: object) =>
  line({
    type: 'assistant',
    cwd,
    timestamp: at(ago),
    message: {
      model: 'claude-opus-5-5',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Running it now' },
        { type: 'tool_use', id: 't1', name, input },
      ],
      usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 40_000, output_tokens: 50 },
    },
  })
const endTurn = (cwd: string, ago: number) =>
  line({
    type: 'assistant',
    cwd,
    timestamp: at(ago),
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
  })
const toolResult = (cwd: string, ago: number) =>
  line({
    type: 'user',
    cwd,
    timestamp: at(ago),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  })

let home: string

function write(path: string, lines: string[], secondsAgo: number) {
  writeFileSync(path, lines.join('\n') + '\n')
  const time = (NOW - secondsAgo * 1000) / 1000
  utimesSync(path, time, time)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agenthq-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function session(folder: string, id: string, cwd: string, lines: string[], secondsAgo: number) {
  const dir = join(home, 'projects', folder)
  mkdirSync(join(dir, id, 'subagents'), { recursive: true })
  write(join(dir, `${id}.jsonl`), lines, secondsAgo)
  return join(dir, id, 'subagents')
}

function subagent(dir: string, id: string, meta: object, lines: string[], secondsAgo: number) {
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify(meta))
  write(join(dir, `agent-${id}.jsonl`), lines, secondsAgo)
}

describe('offices', () => {
  it('turns a session into a manager, staff and their interns', () => {
    const cwd = '/Users/me/Code/shop'
    const dir = session('-Users-me-Code-shop', 's1', cwd, [title('Add CSV export'), prompt(cwd, 900), endTurn(cwd, 400)], 400)
    const teammate = {
      name: 'core',
      color: 'green',
      spawnDepth: 0,
      taskKind: 'in_process_teammate',
      permissionMode: 'auto',
      model: 'claude-opus-5-5',
    }
    subagent(
      dir,
      'acore-1',
      teammate,
      [toolUse(cwd, 180, 'Bash', { command: 'npx vitest run', description: 'Run the unit tests' })],
      180,
    )
    subagent(dir, 'aqa-2', { ...teammate, name: 'qa', color: 'blue' }, [endTurn(cwd, 300)], 300)
    subagent(
      dir,
      'a9f3',
      { spawnDepth: 1, parentAgentId: 'acore-1', description: 'Research CSV libraries' },
      [toolUse(cwd, 2, 'WebSearch', { query: 'csv streaming' })],
      2,
    )
    subagent(
      dir,
      'a7c1',
      { spawnDepth: 1, parentAgentId: 'acore-1', description: 'Old helper', finished: true },
      [endTurn(cwd, 600)],
      600,
    )

    const [office] = discoverOffices({ home, now: NOW })
    expect(office).toBeDefined()
    expect(office!.project).toBe('shop')
    expect(office!.title).toBe('Add CSV export')
    // The manager finished its turn a while ago, but its team is working: it watches.
    expect(office!.manager).toMatchObject({ role: 'manager', state: 'idle', rest: 'watching' })

    const [core, qa] = office!.staff
    // A slow command in auto mode is still running, not waiting for anyone.
    expect(core).toMatchObject({
      name: 'core',
      color: 'green',
      state: 'working',
      tool: { activity: 'test', target: 'Run the unit tests' },
    })
    expect(core!.contextTokens).toBe(40_210)
    expect(qa).toMatchObject({ name: 'qa', state: 'idle', rest: 'coffee' })

    expect(office!.interns).toHaveLength(1)
    expect(office!.interns[0]).toMatchObject({
      parentId: 'acore-1',
      task: 'Research CSV libraries',
      state: 'working',
      tool: { activity: 'web', target: 'csv streaming' },
    })
    expect(office!.wentHome).toBe(1)
  })

  it('lets a helper work in the mode of the teammate that started it', () => {
    const cwd = '/Users/me/Code/app'
    const dir = session('-Users-me-Code-app', 's3', cwd, [prompt(cwd, 10)], 10)
    subagent(dir, 'acore-1', { name: 'core', spawnDepth: 0, permissionMode: 'auto' }, [endTurn(cwd, 30)], 30)
    subagent(dir, 'a1', { spawnDepth: 1, parentAgentId: 'acore-1' }, [toolUse(cwd, 40, 'WebSearch', { query: 'x' })], 40)
    subagent(dir, 'a2', { spawnDepth: 2, parentAgentId: 'a1' }, [toolUse(cwd, 40, 'Read', { file_path: '/x' })], 40)
    subagent(dir, 'a3', { spawnDepth: 1, parentAgentId: 'missing' }, [toolUse(cwd, 40, 'Read', { file_path: '/x' })], 40)
    const [office] = discoverOffices({ home, now: NOW })
    const state = (id: string) => office!.interns.find((intern) => intern.id === id)!.state
    // A slow tool in auto mode is still running, down the line of helpers…
    expect(state('a1')).toBe('working')
    expect(state('a2')).toBe('working')
    // …but a helper whose line doesn't say may be waiting for you.
    expect(state('a3')).toBe('waiting')
  })

  it('leaves out sessions that ended and background sessions of other tools', () => {
    session('-Users-me-Code-old', 'old', '/Users/me/Code/old', [endTurn('/Users/me/Code/old', 7200)], 7200)
    session(
      '-Users-me--claude-mem-observer-sessions',
      'obs',
      '/Users/me/.claude-mem/observer-sessions',
      [prompt('/Users/me/.claude-mem/observer-sessions', 5)],
      5,
    )
    session('-Users-me-Code-live', 'live', '/Users/me/Code/live', [prompt('/Users/me/Code/live', 5)], 5)
    expect(discoverOffices({ home, now: NOW }).map((office) => office.project)).toEqual(['live'])
  })

  it('keeps a teammate at its desk for a while, but not a quiet helper', () => {
    const cwd = '/Users/me/Code/app'
    const dir = session('-Users-me-Code-app', 's2', cwd, [prompt(cwd, 10)], 10)
    subagent(dir, 'awallet-1', { name: 'wallet', spawnDepth: 0 }, [endTurn(cwd, 3600)], 3600)
    subagent(dir, 'a1b2', { spawnDepth: 1, parentAgentId: 'awallet-1' }, [toolResult(cwd, 3600)], 3600)
    const [office] = discoverOffices({ home, now: NOW })
    expect(office!.staff.map((a) => [a.name, a.rest])).toEqual([['wallet', 'couch']])
    expect(office!.interns).toHaveLength(0)
  })
})

describe('states', () => {
  const tail = (step: 'finished' | 'calledTool' | 'awaitingModel') => ({ ...readTail([]), step })

  it('waits for you when a tool sits unanswered outside auto mode', () => {
    expect(stateOf({ tail: tail('calledTool'), modified: NOW - 3_000, now: NOW }).state).toBe('working')
    expect(stateOf({ tail: tail('calledTool'), modified: NOW - 60_000, now: NOW }).state).toBe('waiting')
    expect(stateOf({ tail: tail('calledTool'), modified: NOW - 60_000, now: NOW, permissionMode: 'auto' }).state).toBe('working')
  })

  it('goes from done to coffee to the couch', () => {
    expect(stateOf({ tail: tail('finished'), modified: NOW - 5_000, now: NOW })).toEqual({ state: 'done', rest: null })
    expect(stateOf({ tail: tail('finished'), modified: NOW - 60_000, now: NOW })).toEqual({ state: 'idle', rest: null })
    expect(stateOf({ tail: tail('finished'), modified: NOW - timing.coffee, now: NOW })).toEqual({
      state: 'idle',
      rest: 'coffee',
    })
    expect(stateOf({ tail: tail('finished'), modified: NOW - timing.couch, now: NOW })).toEqual({ state: 'idle', rest: 'couch' })
    expect(stateOf({ tail: tail('awaitingModel'), modified: NOW - 60_000, now: NOW }).state).toBe('working')
    expect(stateOf({ tail: tail('finished'), modified: NOW, now: NOW, finished: true }).state).toBe('gone')
  })
})

describe('transcripts', () => {
  it('reads the last step, tool, title and context', () => {
    const cwd = '/Users/me/Code/app'
    const result = readTail([
      title('Fix login'),
      prompt(cwd, 60),
      toolUse(cwd, 30, 'Edit', { file_path: '/Users/me/Code/app/src/login.ts' }),
      'not json',
    ])
    expect(result).toMatchObject({
      step: 'calledTool',
      title: 'Fix login',
      cwd,
      model: 'claude-opus-5-5',
      tool: { activity: 'edit', target: 'login.ts' },
    })
    expect(readTail([toolUse(cwd, 30, 'Read', {}), toolResult(cwd, 20)]).step).toBe('awaitingModel')
    expect(readTail([toolUse(cwd, 30, 'Read', {}), endTurn(cwd, 10)])).toMatchObject({ step: 'finished', tool: null })
  })

  it('names each tool by where the agent goes', () => {
    expect(describeTool('Grep', { pattern: 'TODO' })).toEqual({ name: 'Grep', target: 'TODO', activity: 'read' })
    expect(describeTool('Bash', { command: 'npm run build' })).toMatchObject({ activity: 'run', target: 'npm run build' })
    expect(describeTool('WebFetch', { url: 'https://docs.example.com/a/b' })).toMatchObject({
      activity: 'web',
      target: 'docs.example.com',
    })
    expect(describeTool('Agent', { description: 'Review the diff' })).toMatchObject({
      activity: 'delegate',
      target: 'Review the diff',
    })
    expect(describeTool('SendMessage', { to: 'qa' })).toMatchObject({ activity: 'message', target: 'qa' })
    expect(describeTool('SomethingNew', {})).toMatchObject({ activity: 'tool', target: null })
  })

  it('reads only whole lines from the end of a big file', () => {
    const path = join(home, 'big.jsonl')
    const lines = Array.from({ length: 5000 }, (_, i) => line({ type: 'user', n: i }))
    writeFileSync(path, lines.join('\n') + '\n')
    const tailLines = readTailLines(path, 4096)
    expect(tailLines.at(-1)).toBe(lines.at(-1))
    expect(tailLines.every((l) => l.startsWith('{') && l.endsWith('}'))).toBe(true)
  })
})
