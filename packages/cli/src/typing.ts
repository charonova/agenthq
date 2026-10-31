import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { stateDir } from './hook.js'
import { findHost, type Host } from './jump.js'

const run = promisify(execFile)

/**
 * Typing into a session open in Terminal or iTerm2 (macOS, opt-in): your message goes into its
 * tab as if you typed it, then Enter. The tab is found by its terminal device, like going to a
 * session; the text reaches AppleScript as an argument, never as part of the script.
 */

export interface TypeResult {
  done: 'typed' | 'copy'
  /** What the page says: "Typed it into its tab in Terminal", or why it couldn't. */
  message: string
}

export type TypeAction = { kind: 'type'; app: 'Terminal' | 'iTerm'; tty: string } | { kind: 'copy'; reason: string }

const MAX_TYPED = 20_000

/** AgentHQ's own preferences (in its folder, not Claude Code's): typing into terminals is off until you turn it on. */
const configFile = () => join(stateDir(), 'config.json')

function readConfig(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(configFile(), 'utf8'))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Where it can be turned on: macOS, and wherever `AGENTHQ_JUMP=copy` makes it only copy (tests). */
export const canType = (): boolean => process.platform === 'darwin' || process.env.AGENTHQ_JUMP === 'copy'

export function typingEnabled(): boolean {
  return canType() && readConfig().typeIntoTerminals === true
}

export function setTyping(enable: boolean): boolean {
  if (enable && !canType()) throw new Error('Typing into terminals works on macOS only')
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 })
  writeFileSync(configFile(), JSON.stringify({ ...readConfig(), typeIntoTerminals: enable }, null, 2), { mode: 0o600 })
  return typingEnabled()
}

/**
 * One line to type: Claude Code sends a message at the first Enter, so line breaks become
 * spaces; control characters (escape sequences could steer the terminal) are dropped.
 */
export function oneLine(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim()
  )
}

/** Where a message can be typed: only the exact tab of a Terminal or iTerm2 session, found by a plain `ttys123` device. */
export function planTyping(platform: NodeJS.Platform, host: Host | null): TypeAction {
  if (platform !== 'darwin') return { kind: 'copy', reason: 'Typing into terminals works on macOS only' }
  if (!host) return { kind: 'copy', reason: 'Its terminal wasn’t found' }
  const tty = host.tty && /^ttys\d{1,5}$/.test(host.tty) ? host.tty : null
  const app = host.name === 'Terminal' ? 'Terminal' : host.name === 'iTerm' || host.name === 'iTerm2' ? 'iTerm' : null
  if (!app) return { kind: 'copy', reason: `It runs in ${host.name}, which AgentHQ can’t type into` }
  if (!tty) return { kind: 'copy', reason: 'Its terminal tab wasn’t found' }
  return { kind: 'type', app, tty }
}

/**
 * The script that types `item 1 of argv` into the tab on `/dev/<tty>`, without bringing it
 * forward. Terminal's `do script … in` and iTerm2's `write text` both end with Enter. It says
 * "typed" only when it found the tab.
 */
export function typeScript(app: 'Terminal' | 'iTerm', tty: string): string {
  if (!/^ttys\d{1,5}$/.test(tty)) throw new Error('Not a terminal device')
  const device = `/dev/${tty}`
  if (app === 'Terminal') {
    return `on run argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is "${device}" then
          do script (item 1 of argv) in t
          return "typed"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`
  }
  return `on run argv
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is "${device}" then
            tell s to write text (item 1 of argv)
            return "typed"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`
}

/**
 * Types a message into the terminal tab a session runs in. Whenever it can't (another app,
 * another system, `AGENTHQ_JUMP=copy`, macOS said no), the page copies the message instead.
 */
export async function typeInto(home: string, sessionId: string, text: string): Promise<TypeResult> {
  const line = oneLine(text)
  if (!line) throw new Error('Write a message first')
  if (line.length > MAX_TYPED) throw new Error('That message is too long to type')
  const copy = (reason: string): TypeResult => ({ done: 'copy', message: `${reason}: copied your message to paste there` })
  // Tests (and anyone who wants AgentHQ to never steer windows) stop here.
  if (process.env.AGENTHQ_JUMP === 'copy') return copy('Typing is switched off here (AGENTHQ_JUMP=copy)')
  const { running, host } = await findHost(home, sessionId)
  if (!running) return copy('It isn’t running')
  const action = planTyping(process.platform, host)
  if (action.kind === 'copy') return copy(action.reason)
  try {
    // `--`: a message starting with "-" is the message, not an option of osascript's.
    const { stdout } = await run('osascript', ['-e', typeScript(action.app, action.tty), '--', line])
    if (stdout.trim() !== 'typed') return copy(`Its tab wasn’t found in ${action.app}`)
    return { done: 'typed', message: `Typed it into its tab in ${action.app}` }
  } catch {
    // macOS asks once before AgentHQ may control Terminal or iTerm2; until then, it says no.
    return copy(`${action.app} didn’t let AgentHQ type (allow it under System Settings → Privacy & Security → Automation)`)
  }
}
