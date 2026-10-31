import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { runningSessions, type JumpResult, type RunningSession } from '@agenthq/core'

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
}

export type JumpAction =
  | { kind: 'terminal-tab'; app: 'Terminal' | 'iTerm'; tty: string }
  | { kind: 'editor'; appPath: string; folder: string | null; storage: string }
  | { kind: 'activate'; appPath: string }
  | { kind: 'copy'; command: string }

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
export function resumeCommand(session: { sessionId: string; cwd: string | null; kind?: 'claude' | 'codex' }): string {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  const resume = session.kind === 'codex' ? `codex resume ${session.sessionId}` : `claude --resume ${session.sessionId}`
  return `${session.cwd ? `cd ${quote(session.cwd)} && ` : ''}${resume}`
}

/** What to do to bring a session forward, as close to it as its app allows. */
export function planJump(
  platform: NodeJS.Platform,
  host: Host | null,
  session: { sessionId: string; cwd: string | null; kind?: 'claude' | 'codex' },
): JumpAction {
  const copy: JumpAction = { kind: 'copy', command: resumeCommand(session) }
  if (platform !== 'darwin' || !host?.appPath) return copy
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

/** The Codex process and app for a thread (macOS: `ps`, then each `codex`'s folder from `lsof`). */
async function findCodexHost(folder: string | null): Promise<Host | null> {
  if (!folder || process.platform !== 'darwin') return null
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
    case 'copy':
      return { done: 'copy', message: 'Copied the command that resumes it', command: action.command }
  }
}

/** The Claude Code process running a session, and the app it runs in (none on Windows, or when it isn't running). */
export async function findHost(
  home: string,
  sessionId: string,
): Promise<{ running: RunningSession | undefined; host: Host | null }> {
  const running = runningSessions(home).get(sessionId)
  if (!running || process.platform === 'win32') return { running, host: null }
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], { maxBuffer: 16 * 1024 * 1024 })
    return { running, host: hostOf(running.pid, parseProcessTable(stdout)) }
  } catch {
    return { running, host: null }
  }
}

/**
 * Brings a session forward: its terminal tab, its editor window, or its app. When there's no
 * way to (not running anymore, another system, an app we can't steer), the page gets the
 * command that resumes it instead.
 */
export async function jumpTo(
  home: string,
  session: { sessionId: string; cwd: string | null; kind?: 'claude' | 'codex' },
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
