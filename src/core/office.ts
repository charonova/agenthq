import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stateOf } from './state.js'
import { readHeadLines, readTail, readTailLines } from './tail.js'
import type { Agent, Office, Role, Tail } from './types.js'

/** Claude Code's folder: `AGENTHQ_CLAUDE_HOME`, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTHQ_CLAUDE_HOME || env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

export interface DiscoverOptions {
  home?: string
  now?: number
  /** A session counts as live when anything in it changed this recently. */
  liveFor?: number
  /** A teammate keeps its desk for this long after its last work. */
  deskFor?: number
  /** Sessions whose folder contains any of these are left out (other tools' background sessions). */
  ignore?: string[]
}

/** Background sessions other tools run through Claude Code, which aren't anyone's office. */
export const defaultIgnore = ['/.claude-mem/']

/** `AGENTHQ_IGNORE`: more folder fragments to leave out, separated by commas. */
export function ignoreFrom(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.AGENTHQ_IGNORE ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  return [...defaultIgnore, ...extra]
}

/** The metadata Claude Code writes next to each subagent's transcript. */
interface Meta {
  name?: string
  description?: string
  agentType?: string
  spawnDepth?: number
  taskKind?: string
  parentAgentId?: string
  color?: string
  model?: string
  permissionMode?: string
  finished?: boolean
}

const mtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

const list = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** "-Users-me-Code-app" → "app", for a session that hasn't said where it runs yet. */
function projectFromFolder(folder: string): string {
  return folder.split('-').filter(Boolean).pop() ?? folder
}

function tailOf(path: string, withHead = false): Tail {
  const lines = readTailLines(path)
  if (!withHead) return readTail(lines)
  // The title and working folder are near the top; the tail has everything newer.
  const head = readTail(readHeadLines(path))
  const tail = readTail(lines)
  return { ...tail, title: tail.title ?? head.title, cwd: tail.cwd ?? head.cwd, permissionMode: tail.permissionMode ?? head.permissionMode }
}

/** Every live Claude Code session, as an office: its manager, its staff and their interns. */
export function discoverOffices(options: DiscoverOptions = {}): Office[] {
  const home = options.home ?? claudeHome()
  const now = options.now ?? Date.now()
  const liveFor = options.liveFor ?? 30 * 60_000
  const deskFor = options.deskFor ?? 3 * 60 * 60_000
  const ignore = options.ignore ?? defaultIgnore
  const projects = join(home, 'projects')
  const offices: Office[] = []

  for (const folder of list(projects)) {
    const projectDir = join(projects, folder)
    for (const file of list(projectDir)) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -'.jsonl'.length)
      const sessionPath = join(projectDir, file)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      const subagentFiles = list(subagentsDir).filter((name) => name.endsWith('.jsonl'))
      const newest = Math.max(mtime(sessionPath), ...subagentFiles.map((name) => mtime(join(subagentsDir, name))))
      if (now - newest > liveFor) continue
      const office = buildOffice({ sessionId, sessionPath, folder, subagentsDir, subagentFiles, now, liveFor, deskFor })
      const where = office.cwd ?? join(projects, folder)
      if (ignore.some((fragment) => where.includes(fragment) || folder.includes(fragment.replace(/\//g, '-')))) continue
      offices.push(office)
    }
  }
  return offices.sort((a, b) => b.updatedAt - a.updatedAt)
}

interface BuildInput {
  sessionId: string
  sessionPath: string
  folder: string
  subagentsDir: string
  subagentFiles: string[]
  now: number
  liveFor: number
  deskFor: number
}

function buildOffice(input: BuildInput): Office {
  const { sessionId, sessionPath, folder, subagentsDir, subagentFiles, now, liveFor, deskFor } = input
  const modified = mtime(sessionPath)
  const leadTail = tailOf(sessionPath, true)
  const manager: Agent = {
    id: sessionId,
    name: 'Manager',
    role: 'manager',
    color: null,
    parentId: null,
    task: leadTail.title,
    model: leadTail.model,
    ...stateOf({ tail: leadTail, modified, now }),
    tool: leadTail.tool,
    lastText: leadTail.lastText,
    contextTokens: leadTail.contextTokens,
    updatedAt: modified,
  }

  const staff: Agent[] = []
  const interns: Agent[] = []
  let wentHome = 0
  for (const file of subagentFiles) {
    const path = join(subagentsDir, file)
    const id = file.slice('agent-'.length, -'.jsonl'.length)
    const meta = readJson<Meta>(path.replace(/\.jsonl$/, '.meta.json')) ?? {}
    const role: Role = meta.spawnDepth === 0 || meta.taskKind === 'in_process_teammate' ? 'staff' : 'intern'
    const updated = mtime(path)
    if (role === 'intern' && meta.finished) {
      wentHome++
      continue
    }
    // Old work stays out of the office: a teammate keeps a desk for a while, a helper only while live.
    if (now - updated > (role === 'staff' ? deskFor : liveFor)) continue
    const tail = tailOf(path)
    const agent: Agent = {
      id,
      name: meta.name ?? meta.description ?? meta.agentType ?? id,
      role,
      color: meta.color ?? null,
      parentId: role === 'intern' ? meta.parentAgentId ?? sessionId : null,
      task: meta.description ?? null,
      model: meta.model ?? tail.model,
      ...stateOf({ tail, modified: updated, now, permissionMode: meta.permissionMode }),
      tool: tail.tool,
      lastText: tail.lastText,
      contextTokens: tail.contextTokens,
      updatedAt: updated,
    }
    ;(role === 'staff' ? staff : interns).push(agent)
  }
  staff.sort((a, b) => a.name.localeCompare(b.name))
  if (manager.state === 'idle' && [...staff, ...interns].some((agent) => agent.state === 'working')) manager.rest = 'watching'
  interns.sort((a, b) => b.updatedAt - a.updatedAt)

  const cwd = leadTail.cwd
  return {
    sessionId,
    project: cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() ?? folder : projectFromFolder(folder),
    cwd,
    title: leadTail.title,
    manager,
    staff,
    interns,
    wentHome,
    updatedAt: Math.max(modified, ...staff.map((a) => a.updatedAt), ...interns.map((a) => a.updatedAt)),
  }
}

/** Whether a folder looks like Claude Code's. */
export function looksLikeClaudeHome(home: string): boolean {
  return existsSync(join(home, 'projects'))
}
