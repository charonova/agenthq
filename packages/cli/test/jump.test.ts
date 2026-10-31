import { describe, expect, it } from 'vitest'
import {
  codexProcesses,
  hostOf,
  parseLsofCwd,
  parseProcessTable,
  pickCodex,
  planJump,
  resumeCommand,
  terminalScript,
  windowFor,
} from '../src/jump'

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

describe('going to a Codex session', () => {
  // Made-up processes: Codex in a Terminal tab, inside the ChatGPT app, and its background server.
  const codexTable = parseProcessTable(`
    1     0 ??       /sbin/launchd
  900     1 ??       /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  902   900 ttys005  -zsh
  910   902 ttys005  /Users/alex/.codex/packages/standalone/releases/0.166.0/bin/codex
  911   910 ttys005  /Users/alex/.codex/packages/standalone/releases/0.166.0/bin/codex-code-mode-host
 2000     1 ??       /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
 2001  2000 ??       /Applications/ChatGPT.app/Contents/Resources/codex
 3000     1 ??       /Users/alex/.codex/packages/app-server-daemon/releases/0.166.0/bin/codex
`)

  it('finds Codex itself, not its helpers', () => {
    expect(codexProcesses(codexTable).map((row) => row.pid)).toEqual([910, 2001, 3000])
  })

  it('reads a process’s folder from lsof', () => {
    expect(parseLsofCwd('p910\nfcwd\nn/Users/alex/Code/mobile\n')).toBe('/Users/alex/Code/mobile')
    expect(parseLsofCwd('p910\n')).toBeNull()
  })

  it('picks the process in the thread’s folder: a terminal tab first, then an app', () => {
    const found = [
      { pid: 3000, cwd: '/Users/alex/Code/mobile', host: hostOf(3000, codexTable) },
      { pid: 2001, cwd: '/Users/alex/Code/mobile', host: hostOf(2001, codexTable) },
      { pid: 910, cwd: '/Users/alex/Code/mobile', host: hostOf(910, codexTable) },
    ]
    expect(pickCodex(found, '/Users/alex/Code/mobile')).toMatchObject({ pid: 910, host: { name: 'Terminal', tty: 'ttys005' } })
    expect(pickCodex(found.slice(0, 2), '/Users/alex/Code/mobile')).toMatchObject({ pid: 2001, host: { name: 'ChatGPT' } })
    expect(pickCodex(found, '/Users/alex/Code/web')).toBeNull()
    expect(pickCodex(found, null)).toBeNull()
  })

  it('opens its Terminal tab, or copies `codex resume`', () => {
    const session = { sessionId: 'codex-mobile', cwd: '/Users/alex/Code/mobile', kind: 'codex' as const }
    expect(planJump('darwin', hostOf(910, codexTable), session)).toEqual({
      kind: 'terminal-tab',
      app: 'Terminal',
      tty: 'ttys005',
    })
    expect(planJump('darwin', null, session)).toEqual({
      kind: 'copy',
      command: "cd '/Users/alex/Code/mobile' && codex resume codex-mobile",
    })
  })
})
