import { execFile } from 'node:child_process'
import { readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { runningSessions, sourceOf, type JumpResult, type RunningSession } from '@agenthq/core'

const run = promisify(execFile)

/** One row of the process table. */
export interface ProcessRow {
  pid: number
  ppid: number
  tty: string | null
  command: string
}

/** The app a session runs in: the nearest app above its process. */
export interface Host {
  name: string
  /** The `.app` bundle, on macOS. */
  appPath: string | null
  /** The terminal device of the session's process ("ttys004"), for picking the exact tab. */
  tty: string | null
  /** Linux and Windows: an editor's own program, which opens (or brings forward) a folder's window. */
  program?: string
  /** Linux and Windows: a terminal app, which can't be steered to one tab from outside. */
  terminal?: boolean
}

export type JumpAction =
  | { kind: 'terminal-tab'; app: 'Terminal' | 'iTerm'; tty: string }
  | { kind: 'editor'; appPath: string; folder: string | null; storage: string }
  | { kind: 'activate'; appPath: string }
  | { kind: 'open-folder'; program: string; folder: string }
  | { kind: 'copy'; command: string; reason?: string }

/** `ps -axo pid=,ppid=,tty=,comm=`: macOS prints the executable's full path in `comm`. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const tty = match[3]!
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      tty: tty === '??' || tty === '?' ? null : tty,
      command: match[4]!,
    })
  }
  return rows
}

/**
 * The app a process runs in: the nearest ancestor that is a `.app` bundle. For a helper deep
 * inside an editor ("…/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/…"), the
 * outermost bundle is the app.
 */
export function hostOf(pid: number, table: ProcessRow[]): Host | null {
  const byPid = new Map(table.map((row) => [row.pid, row]))
  const self = byPid.get(pid)
  let current = self ? byPid.get(self.ppid) : undefined
  for (let depth = 0; current && depth < 24; depth++) {
    const bundle = current.command.match(/^(.*?\.app)(\/|$)/)
    if (bundle) {
      const appPath = bundle[1]!
      return {
        name: appPath
          .split('/')
          .pop()!
          .replace(/\.app$/, ''),
        appPath,
        tty: self?.tty ?? null,
      }
    }
    if (current.ppid <= 1) break
    current = byPid.get(current.ppid)
  }
  return null
}

/**
 * Linux: apps by the process name `ps` shows (at most 15 characters). Editors open a folder with
 * their own command; terminals can't be told to show one tab.
 */
const linuxEditors: Record<string, { name: string; program: string }> = {
  code: { name: 'Visual Studio Code', program: 'code' },
  'code-insiders': { name: 'Visual Studio Code - Insiders', program: 'code-insiders' },
  cursor: { name: 'Cursor', program: 'cursor' },
  windsurf: { name: 'Windsurf', program: 'windsurf' },
  codium: { name: 'VSCodium', program: 'codium' },
}
const linuxTerminals: Record<string, string> = {
  'gnome-terminal-': 'GNOME Terminal',
  'gnome-terminal': 'GNOME Terminal',
  kgx: 'Console',
  konsole: 'Konsole',
  kitty: 'kitty',
  alacritty: 'Alacritty',
  'wezterm-gui': 'WezTerm',
  tilix: 'Tilix',
  terminator: 'Terminator',
  xterm: 'xterm',
  'ptyxis-agent': 'Ptyxis',
}

/** Linux: the nearest editor or terminal above a process. */
export function hostOfLinux(pid: number, table: ProcessRow[]): Host | null {
  const byPid = new Map(table.map((row) => [row.pid, row]))
  const self = byPid.get(pid)
  let current = self ? byPid.get(self.ppid) : undefined
  for (let depth = 0; current && depth < 24; depth++) {
    const name = current.command.split('/').pop()!
    const editor = linuxEditors[name]
    if (editor) return { name: editor.name, appPath: null, tty: self?.tty ?? null, program: editor.program }
    const terminal = linuxTerminals[name]
    if (terminal) return { name: terminal, appPath: null, tty: self?.tty ?? null, terminal: true }
    if (current.ppid <= 1) break
    current = byPid.get(current.ppid)
  }
  return null
}

/** One row of Windows' process list, as AgentHQ asks PowerShell for it: `pid,ppid,name,path`. */
export interface WindowsProcess {
  pid: number
  ppid: number
  name: string
  path: string | null
}

/** A fixed query (no input goes into it): every process with its parent, name and program. */
export const windowsProcessQuery =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name),$($_.ExecutablePath)" }'

export function parseWindowsTable(text: string): WindowsProcess[] {
  const rows: WindowsProcess[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+),(\d+),([^,]+),(.*)$/)
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), name: match[3]!, path: match[4] || null })
  }
  return rows
}

const windowsEditors: Record<string, string> = {
  'code.exe': 'Visual Studio Code',
  'code - insiders.exe': 'Visual Studio Code - Insiders',
  'cursor.exe': 'Cursor',
  'windsurf.exe': 'Windsurf',
  'vscodium.exe': 'VSCodium',
}
const windowsTerminals: Record<string, string> = {
  'windowsterminal.exe': 'Windows Terminal',
  'wezterm-gui.exe': 'WezTerm',
  'alacritty.exe': 'Alacritty',
}

/** Windows: the nearest editor (whose program opens a folder's window) or terminal above a process. */
export function hostOfWindows(pid: number, table: WindowsProcess[]): Host | null {
  const byPid = new Map(table.map((row) => [row.pid, row]))
  let current = byPid.get(byPid.get(pid)?.ppid ?? -1)
  for (let depth = 0; current && depth < 24; depth++) {
    const name = current.name.toLowerCase()
    const editor = windowsEditors[name]
    if (editor && current.path) return { name: editor, appPath: null, tty: null, program: current.path }
    const terminal = windowsTerminals[name]
    if (terminal) return { name: terminal, appPath: null, tty: null, terminal: true }
    if (current.ppid === 0 || current.ppid === current.pid) break
    current = byPid.get(current.ppid)
  }
  return null
}

/** Editors built on VS Code keep their open windows in `<support>/User/globalStorage/storage.json`. */
const editorStorage: Record<string, string> = {
  'Visual Studio Code': 'Code',
  'Visual Studio Code - Insiders': 'Code - Insiders',
  Cursor: 'Cursor',
  Windsurf: 'Windsurf',
  Antigravity: 'Antigravity',
  VSCodium: 'VSCodium',
}

/** A shell-safe way to resume the session where it ran. */
export function resumeCommand(session: { sessionId: string; cwd: string | null; kind?: string }): string {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  const resume = (sourceOf(session.kind ?? 'claude') ?? sourceOf('claude')!).resume(session.sessionId)
  return `${session.cwd ? `cd ${quote(session.cwd)} && ` : ''}${resume}`
}

/** What to do to bring a session forward, as close to it as its app allows. */
export function planJump(
  platform: NodeJS.Platform,
  host: Host | null,
  session: { sessionId: string; cwd: string | null; kind?: string },
): JumpAction {
  const copy: JumpAction = { kind: 'copy', command: resumeCommand(session) }
  // Linux and Windows: an editor's window, by opening its folder; a terminal's tab can't be picked from outside.
  if (platform !== 'darwin') {
    if (host?.program && session.cwd) return { kind: 'open-folder', program: host.program, folder: session.cwd }
    if (host?.terminal) return { ...copy, reason: `${host.name} can’t be told to show one tab` }
    return copy
  }
  if (!host?.appPath) return copy
  // A terminal tab is chosen by its device; only the plain "ttys123" form goes into the script.
  const tty = host.tty && /^ttys?\d+$/.test(host.tty) ? host.tty : null
  if (host.name === 'Terminal' && tty) return { kind: 'terminal-tab', app: 'Terminal', tty }
  if ((host.name === 'iTerm' || host.name === 'iTerm2') && tty) return { kind: 'terminal-tab', app: 'iTerm', tty }
  const storage = editorStorage[host.name]
  if (storage) return { kind: 'editor', appPath: host.appPath, folder: session.cwd, storage }
  return { kind: 'activate', appPath: host.appPath }
}

/** Terminal and iTerm2 can select a tab by its terminal device. */
export function terminalScript(app: 'Terminal' | 'iTerm', tty: string): string {
  const device = `/dev/${tty}`
  if (app === 'Terminal') {
    return `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${device}" then
        set selected of t to true
        set index of w to 1
      end if
    end repeat
  end repeat
  activate
end tell`
  }
  return `tell application "iTerm"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${device}" then
          select w
          select t
          select s
        end if
      end repeat
    end repeat
  end repeat
  activate
end tell`
}

/** The folders an editor has open, from its own state file (read only). */
function openFolders(storage: string): string[] {
  try {
    const file = join(homedir(), 'Library', 'Application Support', storage, 'User', 'globalStorage', 'storage.json')
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      windowsState?: { lastActiveWindow?: { folder?: string }; openedWindows?: { folder?: string }[] }
    }
    const windows = [state.windowsState?.lastActiveWindow, ...(state.windowsState?.openedWindows ?? [])]
    return windows.flatMap((window) => {
      if (!window?.folder?.startsWith('file://')) return []
      try {
        return [decodeURIComponent(new URL(window.folder).pathname)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/** The open window for a folder: the folder itself, or the closest open folder above it. */
export function windowFor(folder: string, open: string[]): string | null {
  const candidates = open.filter((dir) => folder === dir || folder.startsWith(dir.endsWith('/') ? dir : dir + '/'))
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null
}

/** Codex's own processes: the `codex` program itself, not its helpers (`codex-code-mode-host`…). */
export function codexProcesses(table: ProcessRow[]): ProcessRow[] {
  return table.filter((row) => /(^|\/)codex$/.test(row.command))
}

/** `lsof -a -p <pid> -d cwd -Fn` prints `p<pid>`, `fcwd`, then `n<folder>`. */
export function parseLsofCwd(text: string): string | null {
  const line = text.split('\n').find((part) => part.startsWith('n/'))
  return line ? line.slice(1) : null
}

/**
 * The Codex process working on a thread, found by its folder (Codex keeps no pid ↔ thread file):
 * one in a terminal tab first, then one inside an app (Codex's or ChatGPT's, an editor), then any.
 */
export function pickCodex(found: { pid: number; cwd: string | null; host: Host | null }[], folder: string | null) {
  if (!folder) return null
  const rank = (candidate: (typeof found)[number]) => (candidate.host?.tty ? 2 : candidate.host ? 1 : 0)
  return found.filter((candidate) => candidate.cwd === folder).sort((a, b) => rank(b) - rank(a))[0] ?? null
}

/** The Codex process and app for a thread (`ps`, then each `codex`'s folder: `lsof` on macOS, `/proc` on Linux). */
async function findCodexHost(folder: string | null): Promise<Host | null> {
  if (!folder || process.platform === 'win32') return null
  if (process.platform === 'linux') {
    try {
      const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { maxBuffer: 16 * 1024 * 1024 })
      const table = parseProcessTable(stdout)
      const found = codexProcesses(table)
        .slice(0, 24)
        .map((row) => {
          let cwd: string | null = null
          try {
            cwd = readlinkSync(`/proc/${row.pid}/cwd`)
          } catch {
            cwd = null
          }
          return { pid: row.pid, cwd, host: hostOfLinux(row.pid, table) }
        })
      return pickCodex(found, folder)?.host ?? null
    } catch {
      return null
    }
  }
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { maxBuffer: 16 * 1024 * 1024 })
    const table = parseProcessTable(stdout)
    const found = await Promise.all(
      codexProcesses(table)
        .slice(0, 24)
        .map(async (row) => {
          try {
            const { stdout: lsof } = await run('lsof', ['-a', '-p', String(row.pid), '-d', 'cwd', '-Fn'], { timeout: 3000 })
            return { pid: row.pid, cwd: parseLsofCwd(lsof), host: hostOf(row.pid, table) }
          } catch {
            return { pid: row.pid, cwd: null, host: null }
          }
        }),
    )
    return pickCodex(found, folder)?.host ?? null
  } catch {
    return null
  }
}

/** Carries out a plan. Only programs run directly (never a shell), with fixed arguments. */
async function perform(action: JumpAction, host: Host | null): Promise<JumpResult> {
  switch (action.kind) {
    case 'terminal-tab':
      await run('osascript', ['-e', terminalScript(action.app, action.tty)])
      return { done: 'opened', message: `Opened its tab in ${action.app}` }
    case 'editor': {
      // Opening a folder that's already open brings its window forward; another folder would
      // open a new window, so then the editor just comes forward.
      const window = action.folder ? windowFor(action.folder, openFolders(action.storage)) : null
      await run('open', window ? ['-a', action.appPath, window] : ['-a', action.appPath])
      return {
        done: 'opened',
        message: `Opened ${host?.name ?? 'the editor'}${window ? '' : ' (its window for this folder wasn’t found)'}`,
      }
    }
    case 'activate':
      await run('open', ['-a', action.appPath])
      return { done: 'opened', message: `Opened ${host?.name ?? 'its app'}` }
    case 'open-folder':
      // The editor's own program, with the folder as its only argument: its window comes forward.
      await run(action.program, [action.folder], { timeout: 15_000, windowsHide: true })
      return { done: 'opened', message: `Opened ${host?.name ?? 'the editor'}` }
    case 'copy':
      return {
        done: 'copy',
        message: action.reason ? `${action.reason}: copied the command that resumes it` : 'Copied the command that resumes it',
        command: action.command,
      }
  }
}

/** The Claude Code process running a session, and the app it runs in (none on Windows, or when it isn't running). */
export async function findHost(
  home: string,
  sessionId: string,
): Promise<{ running: RunningSession | undefined; host: Host | null }> {
  const running = runningSessions(home).get(sessionId)
  if (!running) return { running, host: null }
  return { running, host: await hostFor(running.pid) }
}

/** The app above a process, on any system (null when there's none, or the process table can't be read). */
async function hostFor(pid: number): Promise<Host | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsProcessQuery], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      })
      return hostOfWindows(pid, parseWindowsTable(stdout))
    }
    const table = parseProcessTable((await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { maxBuffer: 16 * 1024 * 1024 })).stdout)
    return process.platform === 'darwin' ? hostOf(pid, table) : hostOfLinux(pid, table)
  } catch {
    return null
  }
}

/**
 * Brings a session forward: its terminal tab, its editor window, or its app. When there's no
 * way to (not running anymore, another system, an app we can't steer), the page gets the
 * command that resumes it instead.
 */
export async function jumpTo(
  home: string,
  session: { sessionId: string; cwd: string | null; kind?: string },
): Promise<JumpResult> {
  // AGENTHQ_JUMP=copy: never open windows, only copy the command (tests, or a preference).
  if (process.env.AGENTHQ_JUMP === 'copy') {
    return { done: 'copy', message: 'Copied the command that resumes it', command: resumeCommand(session) }
  }
  if (session.kind === 'codex') {
    const host = await findCodexHost(session.cwd)
    try {
      return await perform(planJump(process.platform, host, session), host)
    } catch {
      return {
        done: 'copy',
        message: `Couldn’t open ${host?.name ?? 'it'}: copied the command that resumes it`,
        command: resumeCommand(session),
      }
    }
  }
  const { running, host } = await findHost(home, session.sessionId)
  const action = planJump(process.platform, running ? host : null, {
    sessionId: session.sessionId,
    cwd: running?.cwd ?? session.cwd,
  })
  try {
    return await perform(action, host)
  } catch {
    // The app said no (macOS may ask for permission to control it first): fall back.
    return {
      done: 'copy',
      message: `Couldn’t open ${host?.name ?? 'it'}: copied the command that resumes it`,
      command: resumeCommand(session),
    }
  }
}
