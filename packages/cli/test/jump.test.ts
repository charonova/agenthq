import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  codexProcesses,
  hostOf,
  hostOfLinux,
  hostOfWindows,
  parseWindowsTable,
  windowsProcessQuery,
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

describe('going to a session on Linux and Windows', () => {
  const session = { sessionId: 'abc', cwd: '/home/alex/Code/shop' }

  // Made-up `ps -axo pid=,ppid=,tty=,comm=` on Linux: names only, cut at 15 characters.
  const linux = parseProcessTable(`
    1     0 ?        systemd
 1200     1 ?        code
 1250  1200 ?        code
 1300  1250 pts/3    bash
 1301  1300 pts/3    claude
 2000     1 ?        gnome-terminal-
 2001  2000 pts/5    bash
 2002  2001 pts/5    claude
`)

  it('opens the folder’s window in VS Code with its own command', () => {
    const host = hostOfLinux(1301, linux)
    expect(host).toMatchObject({ name: 'Visual Studio Code', program: 'code', tty: 'pts/3' })
    expect(planJump('linux', host, session)).toEqual({ kind: 'open-folder', program: 'code', folder: '/home/alex/Code/shop' })
  })

  it('copies the command for GNOME Terminal, which can’t be told to show one tab', () => {
    const host = hostOfLinux(2002, linux)
    expect(host).toMatchObject({ name: 'GNOME Terminal', terminal: true })
    expect(planJump('linux', host, session)).toEqual({
      kind: 'copy',
      command: "cd '/home/alex/Code/shop' && claude --resume abc",
      reason: 'GNOME Terminal can’t be told to show one tab',
    })
  })

  // Made-up lines of the PowerShell query: pid,ppid,name,program.
  const windows = parseWindowsTable(
    [
      '4,0,System,',
      '5000,1,Code.exe,C:\\Users\\alex\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      '5100,5000,Code.exe,C:\\Users\\alex\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      '5200,5100,pwsh.exe,C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      '5300,5200,claude.exe,C:\\Users\\alex\\.local\\bin\\claude.exe',
      '6000,1,WindowsTerminal.exe,C:\\Program Files\\WindowsApps\\WindowsTerminal.exe',
      '6100,6000,pwsh.exe,',
      '6200,6100,node.exe,C:\\nodejs\\node.exe',
    ].join('\r\n'),
  )

  it('reads the process list, and opens the folder in the editor’s own program', () => {
    expect(windows).toHaveLength(8)
    expect(windows[0]).toEqual({ pid: 4, ppid: 0, name: 'System', path: null })
    const host = hostOfWindows(5300, windows)
    expect(host).toMatchObject({ name: 'Visual Studio Code', program: windows[1]!.path })
    expect(planJump('win32', host, { sessionId: 'abc', cwd: 'C:\\Code\\shop' })).toEqual({
      kind: 'open-folder',
      program: windows[1]!.path,
      folder: 'C:\\Code\\shop',
    })
  })

  it('copies the command for Windows Terminal', () => {
    const host = hostOfWindows(6200, windows)
    expect(host).toMatchObject({ name: 'Windows Terminal', terminal: true })
    expect(planJump('win32', host, session)).toMatchObject({
      kind: 'copy',
      reason: 'Windows Terminal can’t be told to show one tab',
    })
    expect(planJump('win32', null, session)).toMatchObject({ kind: 'copy' })
  })
})

describe('the real process list (read only)', () => {
  it.runIf(process.platform === 'win32')('Windows: the PowerShell query lists this test with its parent', () => {
    const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsProcessQuery], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    const self = parseWindowsTable(text).find((row) => row.pid === process.pid)
    expect(self).toMatchObject({ ppid: process.ppid })
    expect(self?.name.toLowerCase()).toContain('node')
  })

  it.runIf(process.platform !== 'win32')('macOS and Linux: ps lists this test with its parent', () => {
    const text = execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    expect(parseProcessTable(text).find((row) => row.pid === process.pid)).toMatchObject({ ppid: process.ppid })
  })
})
