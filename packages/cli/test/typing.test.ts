import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { oneLine, planTyping, setTyping, typeInto, typeScript, typingEnabled } from '../src/typing'

const terminal = { name: 'Terminal', appPath: '/System/Applications/Utilities/Terminal.app', tty: 'ttys004' }

describe('typing into a terminal tab', () => {
  it('types into Terminal and iTerm2 tabs only, found by a plain device name, on macOS only', () => {
    expect(planTyping('darwin', terminal)).toEqual({ kind: 'type', app: 'Terminal', tty: 'ttys004' })
    expect(planTyping('darwin', { ...terminal, name: 'iTerm2' })).toEqual({ kind: 'type', app: 'iTerm', tty: 'ttys004' })
    expect(planTyping('darwin', { ...terminal, name: 'Visual Studio Code' })).toMatchObject({ kind: 'copy' })
    expect(planTyping('darwin', { ...terminal, tty: 'ttys004"; do shell script "x' })).toMatchObject({ kind: 'copy' })
    expect(planTyping('darwin', { ...terminal, tty: 'pts/3' })).toMatchObject({ kind: 'copy' })
    expect(planTyping('darwin', null)).toMatchObject({ kind: 'copy' })
    expect(planTyping('linux', terminal)).toMatchObject({ kind: 'copy', reason: 'Typing into terminals works on macOS only' })
  })

  it('hands the message to AppleScript as an argument, never inside the script', () => {
    for (const app of ['Terminal', 'iTerm'] as const) {
      const script = typeScript(app, 'ttys012')
      expect(script).toContain('on run argv')
      expect(script).toContain('item 1 of argv')
      expect(script).toContain('"/dev/ttys012"')
    }
    expect(typeScript('Terminal', 'ttys012')).toContain('do script (item 1 of argv) in t')
    expect(typeScript('iTerm', 'ttys012')).toContain('write text (item 1 of argv)')
    expect(() => typeScript('Terminal', 'ttys1" & quit')).toThrow()
  })

  it('sends one line: Enter would send the message early, and control characters could steer the terminal', () => {
    expect(oneLine('  fix the tests\n\nthen   commit  ')).toBe('fix the tests then   commit')
    expect(oneLine('a\u001b[2Jb\u0007c\r\nd')).toBe('a[2Jbc d')
    expect(oneLine('\n \n')).toBe('')
  })
})

describe('the switch', () => {
  let state: string
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'agenthq-typing-'))
    process.env.AGENTHQ_STATE_DIR = state
    process.env.AGENTHQ_JUMP = 'copy'
  })
  afterEach(() => {
    delete process.env.AGENTHQ_STATE_DIR
    delete process.env.AGENTHQ_JUMP
    rmSync(state, { recursive: true, force: true })
  })

  it('is off until turned on, and lives in AgentHQ’s own folder', () => {
    expect(typingEnabled()).toBe(false)
    expect(setTyping(true)).toBe(true)
    expect(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8'))).toEqual({ typeIntoTerminals: true })
    expect(setTyping(false)).toBe(false)
  })

  it('never touches a window under AGENTHQ_JUMP=copy: the message is copied instead', async () => {
    const result = await typeInto(state, 'session-1', 'hello\nthere')
    expect(result.done).toBe('copy')
    expect(result.message).toContain('copied your message')
    await expect(typeInto(state, 'session-1', ' \n ')).rejects.toThrow('Write a message first')
  })
})
