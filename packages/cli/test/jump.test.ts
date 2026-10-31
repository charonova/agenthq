import { describe, expect, it } from 'vitest'
import { hostOf, parseProcessTable, planJump, resumeCommand, terminalScript, windowFor } from '../src/jump'

// Shaped like `ps -axo pid=,ppid=,tty=,comm=` on macOS, with made-up processes.
const table = parseProcessTable(`
    1     0 ??       /sbin/launchd
  900     1 ??       /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  901   900 ttys000  login
  902   901 ttys000  -zsh
  903   902 ttys000  claude
 1700     1 ??       /Applications/Visual Studio Code.app/Contents/MacOS/Electron
 1708  1700 ??       /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper
 3018  1708 ttys003  /bin/zsh
 5403  3018 ttys003  2.1.310
 6000     1 ??       /usr/sbin/sshd
 6001  6000 ttys009  claude
`)

describe('finding the app', () => {
  it('reads the process table', () => {
    expect(table).toHaveLength(11)
    expect(table[1]).toEqual({
      pid: 900,
      ppid: 1,
      tty: null,
      command: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    })
  })

  it('walks up to the terminal, keeping the session’s own tab', () => {
    expect(hostOf(903, table)).toEqual({
      name: 'Terminal',
      appPath: '/System/Applications/Utilities/Terminal.app',
      tty: 'ttys000',
    })
  })

  it('takes the editor, not its helper, for a session in its terminal', () => {
    expect(hostOf(5403, table)).toMatchObject({ name: 'Visual Studio Code', appPath: '/Applications/Visual Studio Code.app' })
  })

  it('finds no app for a session over ssh', () => {
    expect(hostOf(6001, table)).toBeNull()
  })
})

describe('planning the jump', () => {
  const session = { sessionId: 'abc-123', cwd: '/Users/me/Code/shop' }

  it('selects the exact Terminal tab', () => {
    expect(planJump('darwin', hostOf(903, table), session)).toEqual({ kind: 'terminal-tab', app: 'Terminal', tty: 'ttys000' })
  })

  it('opens the editor window for the folder', () => {
    expect(planJump('darwin', hostOf(5403, table), session)).toEqual({
      kind: 'editor',
      appPath: '/Applications/Visual Studio Code.app',
      folder: '/Users/me/Code/shop',
      storage: 'Code',
    })
  })

  it('copies the resume command when there is no app to open', () => {
    expect(planJump('darwin', null, session)).toEqual({
      kind: 'copy',
      command: "cd '/Users/me/Code/shop' && claude --resume abc-123",
    })
    expect(planJump('linux', hostOf(903, table), session).kind).toBe('copy')
  })

  it('never puts an odd terminal name into the script', () => {
    const host = { name: 'Terminal', appPath: '/System/Applications/Utilities/Terminal.app', tty: 'ttys0" & do shell script "x' }
    expect(planJump('darwin', host, session)).toEqual({ kind: 'activate', appPath: host.appPath })
    expect(terminalScript('Terminal', 'ttys004')).toContain('"/dev/ttys004"')
  })

  it('quotes folders with quotes in them', () => {
    expect(resumeCommand({ sessionId: 's', cwd: "/Users/me/it's here" })).toBe(
      "cd '/Users/me/it'\\''s here' && claude --resume s",
    )
  })

  it('finds the open window for a folder or one above it', () => {
    const open = ['/Users/me/Code/shop', '/Users/me/Code', '/Users/me/Code/shopping']
    expect(windowFor('/Users/me/Code/shop/api', open)).toBe('/Users/me/Code/shop')
    expect(windowFor('/Users/me/Code/blog', open)).toBe('/Users/me/Code')
    expect(windowFor('/tmp/x', open)).toBeNull()
  })
})
