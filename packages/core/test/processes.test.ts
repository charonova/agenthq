import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runningSessions } from '../src/processes.js'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agenthq-'))
  mkdirSync(join(home, 'sessions'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const write = (name: string, value: object | string) =>
  writeFileSync(join(home, 'sessions', name), typeof value === 'string' ? value : JSON.stringify(value))

it('maps running sessions to their processes, and skips ended ones', () => {
  // Shaped like Claude Code's own files, with made-up ids.
  write('100.json', {
    pid: 100,
    sessionId: 'aaaa',
    cwd: '/Users/me/Code/shop',
    entrypoint: 'cli',
    status: 'busy',
    kind: 'interactive',
  })
  write('200.json', { pid: 200, sessionId: 'bbbb', cwd: '/Users/me/Code/blog', entrypoint: 'cli', status: 'idle' })
  write('100.secretsecret.key', 'never read')
  write('300.json', '{ half written')
  const running = runningSessions(home, (pid) => pid === 100)
  expect([...running.keys()]).toEqual(['aaaa'])
  expect(running.get('aaaa')).toEqual({
    pid: 100,
    sessionId: 'aaaa',
    cwd: '/Users/me/Code/shop',
    entrypoint: 'cli',
    status: 'busy',
  })
})

it('finds nothing without a sessions folder', () => {
  expect(runningSessions(join(home, 'missing')).size).toBe(0)
})
