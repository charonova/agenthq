import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A Claude Code process that's running now, from the file it keeps in `~/.claude/sessions`. */
export interface RunningSession {
  pid: number
  sessionId: string
  cwd: string | null
  /** "cli", "sdk-cli"… */
  entrypoint: string | null
  /** Claude Code's own word for what it's doing: "busy", "idle", "waiting", "shell". */
  status: string | null
  /** While "waiting": what for, one of Claude Code's own few words. */
  waitingFor: string | null
}

/** What Claude Code says a session waits for (its own fixed words; anything else is left out). */
export const waitingReasons = ['permission prompt', 'input needed', 'dialog open', 'goal proposal', 'sandbox request']

/** Whether a process is still alive (signal 0 checks without touching it). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: alive, but someone else's.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Every running Claude Code session, by session id. Claude Code writes `<pid>.json` for each
 * process it runs; files of processes that ended are left behind, so only live ones count.
 * The `.key` files next to them are secrets and are never read.
 */
export function runningSessions(home: string, alive: (pid: number) => boolean = isAlive): Map<string, RunningSession> {
  const dir = join(home, 'sessions')
  const found = new Map<string, RunningSession>()
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => /^\d+\.json$/.test(file))
  } catch {
    return found
  }
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>
      const pid = typeof data.pid === 'number' ? data.pid : Number.parseInt(file, 10)
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null
      if (!sessionId || !Number.isInteger(pid) || !alive(pid)) continue
      const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
      const waitingFor = typeof data.waitingFor === 'string' && waitingReasons.includes(data.waitingFor) ? data.waitingFor : null
      found.set(sessionId, {
        pid,
        sessionId,
        cwd: text(data.cwd),
        entrypoint: text(data.entrypoint),
        status: text(data.status),
        waitingFor,
      })
    } catch {
      // Half-written or not ours: skip it.
    }
  }
  return found
}
