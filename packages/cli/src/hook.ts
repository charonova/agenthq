import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Answering from AgentHQ: a `PermissionRequest` hook in Claude Code's settings hands each
 * permission prompt and question to AgentHQ and waits for your answer. Claude Code still shows
 * the prompt in its terminal meanwhile, and whichever answers first wins. Without AgentHQ
 * running, the hook steps aside at once.
 */

/** AgentHQ's own folder: the hook, the running server's address and secret, the log of answers. */
export const stateDir = (): string => process.env.AGENTHQ_STATE_DIR ?? join(homedir(), '.agenthq')

export const HOOK_FILE = 'agenthq-permission-hook.mjs'
/** How long Claude Code lets the hook wait for you (seconds). The terminal can answer any time. */
export const HOOK_TIMEOUT = 3600

/**
 * The hook. Plain Node with no dependencies, written into AgentHQ's folder: it finds the server
 * in `server.json` next to it, asks it with the secret from that file, and prints the answer.
 * Any trouble, or no answer: it prints nothing, and Claude Code's own prompt decides.
 */
export const hookScript = `// AgentHQ's permission hook: hands Claude Code's permission prompts to AgentHQ and waits for your answer.
// Installed from AgentHQ (🔔 → Answer from AgentHQ); remove it there too. Without AgentHQ running, it does nothing.
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const quit = () => process.exit(0)
// Sessions AgentHQ runs itself get their prompts straight from it.
if (process.env.AGENTHQ_MANAGED) quit()
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (raw += chunk))
process.stdin.on('end', () => {
  let server
  try {
    server = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'server.json'), 'utf8'))
    process.kill(server.pid, 0)
  } catch (error) {
    if (!server || error.code !== 'EPERM') return quit()
  }
  const ask = request(
    {
      host: '127.0.0.1',
      port: server.port,
      path: '/api/hook',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + server.token },
    },
    (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => {
        try {
          const { decision } = response.statusCode === 200 ? JSON.parse(body) : {}
          if (decision) return process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }), quit)
        } catch {}
        quit()
      })
    },
  )
  ask.on('error', quit)
  ask.end(raw)
})
`

type Json = Record<string, unknown>
interface HookEntry {
  type?: string
  command?: string
  timeout?: number
}
interface HookGroup {
  matcher?: string
  hooks?: HookEntry[]
}

const ours = (entry: HookEntry) => typeof entry.command === 'string' && entry.command.includes(HOOK_FILE)

/** Whether the settings have AgentHQ's hook. */
export function hasHook(settings: Json): boolean {
  const groups = (settings.hooks as Json | undefined)?.PermissionRequest
  return Array.isArray(groups) && (groups as HookGroup[]).some((group) => group.hooks?.some(ours))
}

/** The settings with AgentHQ's hook added (once), everything else as it was. */
export function withHook(settings: Json, command: string): Json {
  const clean = withoutHook(settings)
  const hooks = { ...((clean.hooks as Json | undefined) ?? {}) }
  const groups = Array.isArray(hooks.PermissionRequest) ? [...(hooks.PermissionRequest as HookGroup[])] : []
  groups.push({ matcher: '*', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT }] })
  return { ...clean, hooks: { ...hooks, PermissionRequest: groups } }
}

/** The settings without AgentHQ's hook: other hooks stay exactly as they were. */
export function withoutHook(settings: Json): Json {
  const hooks = settings.hooks as Json | undefined
  if (!hooks || !Array.isArray(hooks.PermissionRequest)) return settings
  const groups = (hooks.PermissionRequest as HookGroup[])
    .map((group) => (group.hooks?.some(ours) ? { ...group, hooks: group.hooks.filter((entry) => !ours(entry)) } : group))
    .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0)
  const rest = { ...hooks }
  if (groups.length) rest.PermissionRequest = groups
  else delete rest.PermissionRequest
  // Spreading keeps the keys where they were in the file.
  if (Object.keys(rest).length) return { ...settings, hooks: rest }
  const { hooks: _hooks, ...others } = settings
  return others
}

const settingsPath = (claudeHome: string) => join(claudeHome, 'settings.json')

function readSettings(path: string): Json {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  if (!text.trim()) return {}
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings.json isn’t a JSON object')
  return value as Json
}

/** Whether answering from AgentHQ is on: its hook is in Claude Code's user settings. */
export function answeringEnabled(claudeHome: string): boolean {
  try {
    return hasHook(readSettings(settingsPath(claudeHome)))
  } catch {
    return false
  }
}

/** Writes the hook into AgentHQ's folder (kept up to date on every start). */
export function writeHookScript(): string {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, HOOK_FILE)
  writeFileSync(path, hookScript)
  return path
}

/**
 * Turns answering from AgentHQ on or off: adds or removes its hook in `~/.claude/settings.json`,
 * after saving a copy of the file as it was. A file that isn't valid JSON is left alone.
 */
export function setAnswering(claudeHome: string, enable: boolean): { enabled: boolean; backup: string | null } {
  const path = settingsPath(claudeHome)
  const settings = readSettings(path)
  if (hasHook(settings) === enable) return { enabled: enable, backup: null }
  const command = `node "${writeHookScript()}"`
  const next = enable ? withHook(settings, command) : withoutHook(settings)
  let backup: string | null = null
  if (existsSync(path)) {
    backup = `${path}.before-agenthq-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(path, backup)
  }
  const temporary = `${path}.agenthq-${process.pid}`
  writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n')
  if (existsSync(path)) chmodSync(temporary, statSync(path).mode & 0o777)
  renameSync(temporary, path)
  return { enabled: enable, backup }
}
