import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOOK_FILE, hasHook, hookScript, setAnswering, withHook, withoutHook } from '../src/hook'

const command = `node "/home/alex/.agenthq/${HOOK_FILE}"`
const theirs = { matcher: '*', hooks: [{ type: 'command', command: 'node ~/.claude/office-status-hook.js' }] }

describe('adding and removing the hook in the settings', () => {
  it('adds it once, next to other hooks, and removes only it', () => {
    const settings = { model: 'opus', hooks: { PermissionRequest: [theirs], Stop: [theirs] }, theme: 'dark' }
    const added = withHook(withHook(settings, command), command)
    expect(hasHook(added)).toBe(true)
    expect((added.hooks as { PermissionRequest: unknown[] }).PermissionRequest).toHaveLength(2)
    expect(Object.keys(added)).toEqual(['model', 'hooks', 'theme'])
    expect(withoutHook(added)).toEqual(settings)
  })

  it('leaves no empty hooks behind', () => {
    expect(withoutHook(withHook({ model: 'opus' }, command))).toEqual({ model: 'opus' })
  })
})

describe('turning answering on and off', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agenthq-hook-'))
    process.env.AGENTHQ_STATE_DIR = join(dir, 'state')
  })
  afterEach(() => {
    delete process.env.AGENTHQ_STATE_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves a copy of the settings first, and refuses a file that isn’t JSON', () => {
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, JSON.stringify({ hooks: { PermissionRequest: [theirs] } }))
    const on = setAnswering(dir, true)
    expect(on.backup && existsSync(on.backup)).toBe(true)
    expect(existsSync(join(dir, 'state', HOOK_FILE))).toBe(true)
    expect(hasHook(JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>)).toBe(true)
    expect(setAnswering(dir, true).backup).toBeNull()
    setAnswering(dir, false)
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({ hooks: { PermissionRequest: [theirs] } })
    writeFileSync(settings, '{ not json')
    expect(() => setAnswering(dir, true)).toThrow()
    expect(readFileSync(settings, 'utf8')).toBe('{ not json')
    expect(readdirSync(dir).filter((file) => file.includes('before-agenthq'))).toHaveLength(2)
  })
})

describe('the hook', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agenthq-hook-'))
    writeFileSync(join(dir, HOOK_FILE), hookScript)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const run = (input: object) =>
    new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [join(dir, HOOK_FILE)])
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
      child.on('exit', () => resolve(out))
      child.stdin.end(JSON.stringify(input))
    })

  it('steps aside without AgentHQ running', () => {
    expect(execFileSync(process.execPath, [join(dir, HOOK_FILE)], { input: '{}' }).toString()).toBe('')
  })

  it('hands the prompt to AgentHQ with its secret, and prints the answer for Claude Code', async () => {
    let seen: { auth?: string; body?: string } = {}
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        seen = { auth: request.headers.authorization, body }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ decision: { behavior: 'allow' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    writeFileSync(join(dir, 'server.json'), JSON.stringify({ port, token: 'secret', pid: process.pid }))
    const out = await run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' })
    server.close()
    expect(seen.auth).toBe('Bearer secret')
    expect(JSON.parse(seen.body!)).toMatchObject({ tool_name: 'Bash' })
    expect(JSON.parse(out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
  })

  it('prints nothing when AgentHQ has no answer, so the terminal decides', async () => {
    const server = createServer((_request, response) => response.writeHead(204).end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ port: (server.address() as { port: number }).port, token: 't', pid: process.pid }),
    )
    const out = await run({ hook_event_name: 'PermissionRequest' })
    server.close()
    expect(out).toBe('')
  })
})
