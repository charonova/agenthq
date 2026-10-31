import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { talksOf } from '../src/office.js'
import { readTail } from '../src/tail.js'
import { parseTask, readTasks, taskListOf } from '../src/tasks.js'

// Shaped like Claude Code's own files, with made-up content.
const send = (to: string, at: string) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'SendMessage', input: { to, message: 'hi' } }] },
  })

describe('who talks to whom', () => {
  it('counts the messages each agent sent, by recipient, leaving broadcasts out', () => {
    const tail = readTail([
      send('qa', '2026-10-31T10:00:00.000Z'),
      send('qa', '2026-10-31T10:05:00.000Z'),
      send('team-lead', '2026-10-31T10:06:00.000Z'),
      send('*', '2026-10-31T10:07:00.000Z'),
    ])
    expect(tail.sent).toEqual({
      qa: { count: 2, at: Date.parse('2026-10-31T10:05:00.000Z') },
      'team-lead': { count: 1, at: Date.parse('2026-10-31T10:06:00.000Z') },
    })
  })

  it('names the lead as the office does, newest first', () => {
    const talks = talksOf(
      new Map<string, Record<string, { count: number; at: number }>>([
        ['api', { 'team-lead': { count: 1, at: 5 }, qa: { count: 3, at: 9 } }],
        ['Manager', { api: { count: 2, at: 7 }, main: { count: 1, at: 8 } }],
      ]),
    )
    expect(talks).toEqual([
      { from: 'api', to: 'qa', count: 3, at: 9 },
      { from: 'Manager', to: 'api', count: 2, at: 7 },
      { from: 'api', to: 'Manager', count: 1, at: 5 },
    ])
  })
})

describe('team tasks', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agenthq-tasks-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const task = (dir: string, id: string, extra: object) => {
    mkdirSync(join(home, 'tasks', dir), { recursive: true })
    writeFileSync(
      join(home, 'tasks', dir, `${id}.json`),
      JSON.stringify({ id, description: 'x', blocks: [], blockedBy: [], ...extra }),
    )
  }

  it('reads a task file, keeping only what the whiteboard needs', () => {
    expect(
      parseTask(
        '{"id":"2","subject":"Write the export","description":"long","status":"in_progress","owner":"api","blocks":[],"blockedBy":["1"]}',
      ),
    ).toEqual({ id: '2', subject: 'Write the export', status: 'in_progress', owner: 'api', blockedBy: ['1'] })
    expect(parseTask('{"id":"3","subject":"x","status":"weird"}')?.status).toBe('pending')
    expect(parseTask('{"subject":"no id"}')).toBeNull()
    expect(parseTask('{ half')).toBeNull()
  })

  it('finds a named team’s list through its config, and a session’s own list otherwise', () => {
    mkdirSync(join(home, 'teams', 'shop-team'), { recursive: true })
    writeFileSync(
      join(home, 'teams', 'shop-team', 'config.json'),
      JSON.stringify({ name: 'shop-team', leadSessionId: 'aaaa-1111' }),
    )
    expect(taskListOf(home, 'aaaa-1111', 1)).toBe(join(home, 'tasks', 'shop-team'))
    expect(taskListOf(home, '0123456789abcdef', 1)).toBe(join(home, 'tasks', 'session-01234567'))
    task('shop-team', '10', { subject: 'Ship it', status: 'pending' })
    task('shop-team', '2', { subject: 'Add tests', status: 'completed', owner: 'qa' })
    writeFileSync(join(home, 'tasks', 'shop-team', '.highwatermark'), '10')
    expect(readTasks(home, 'aaaa-1111', 1).map((t) => t.id)).toEqual(['2', '10'])
    expect(readTasks(home, 'bbbb-2222', 1)).toEqual([])
  })
})
