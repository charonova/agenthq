import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runningSessions, type RunningSession } from './processes.js'
import { applyStatus, stateOf } from './state.js'
import { readHeadLines, readTail, readTailLines } from './tail.js'
import type { Activity, Agent, Office, Role, Tail } from './types.js'

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
  /** Whether a process is alive (tests stand in for the real check). */
  alive?: (pid: number) => boolean
}

/** Background sessions other tools run through Claude Code, which aren't anyone's office. */
export const defaultIgnore = ['/.claude-mem/']

/** `AGENTHQ_IGNORE`: more folder fragments to leave out, separated by commas. */
export function ignoreFrom(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.AGENTHQ_IGNORE ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
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

/** Tails by file, kept until the file changes: the office rescans every couple of seconds. */
const tails = new Map<string, { size: number; modified: number; tail: Tail }>()

function tailOf(path: string, withHead = false): Tail {
  let size = 0
  let modified = 0
  try {
    const stat = statSync(path)
    size = stat.size
    modified = stat.mtimeMs
  } catch {
    // Gone between the listing and now: read nothing.
  }
  const key = path + (withHead ? '#head' : '')
  const cached = tails.get(key)
  if (cached && cached.size === size && cached.modified === modified) return cached.tail
  const tail = readTailOf(path, withHead)
  tails.set(key, { size, modified, tail })
  if (tails.size > 5000) tails.delete(tails.keys().next().value!)
  return tail
}

function readTailOf(path: string, withHead: boolean): Tail {
  let lines: string[]
  try {
    lines = readTailLines(path)
  } catch {
    return readTail([])
  }
  if (!withHead) return readTail(lines)
  // The title and working folder are near the top; the tail has everything newer.
  const head = readTail(readHeadLines(path))
  const tail = readTail(lines)
  return {
    ...tail,
    title: tail.title ?? head.title,
    cwd: tail.cwd ?? head.cwd,
    permissionMode: tail.permissionMode ?? head.permissionMode,
  }
}

interface Candidate {
  folder: string
  sessionId: string
  sessionPath: string
  subagentsDir: string
}

/**
 * Sessions touched in the last day. Claude Code keeps every session it ever ran (thousands), so
 * the full listing is redone only every 30 seconds; in between, only these are looked at.
 */
const candidateCache = new Map<string, { at: number; list: Candidate[] }>()

function candidates(home: string, now: number): Candidate[] {
  const cached = candidateCache.get(home)
  if (cached && now - cached.at < 30_000 && now >= cached.at) return cached.list
  const projects = join(home, 'projects')
  const found: Candidate[] = []
  for (const folder of list(projects)) {
    const projectDir = join(projects, folder)
    for (const file of list(projectDir)) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -'.jsonl'.length)
      const sessionPath = join(projectDir, file)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      // A team keeps working in its subagents' files while the lead's own file sits still.
      if (now - Math.max(mtime(sessionPath), mtime(subagentsDir)) > 24 * 60 * 60_000 && !recentlyWritten(subagentsDir, now))
        continue
      found.push({ folder, sessionId, sessionPath, subagentsDir })
    }
  }
  candidateCache.set(home, { at: now, list: found })
  return found
}

/** Whether any subagent of an old-looking session wrote in the last day (only for sessions that have subagents). */
function recentlyWritten(subagentsDir: string, now: number): boolean {
  return list(subagentsDir).some((name) => now - mtime(join(subagentsDir, name)) < 24 * 60 * 60_000)
}

/** Every live Claude Code session, as an office: its manager, its staff and their interns. */
export function discoverOffices(options: DiscoverOptions = {}): Office[] {
  const home = options.home ?? claudeHome()
  const now = options.now ?? Date.now()
  const liveFor = options.liveFor ?? 30 * 60_000
  const deskFor = options.deskFor ?? 3 * 60 * 60_000
  const ignore = options.ignore ?? defaultIgnore
  const offices: Office[] = []
  // Which sessions have a Claude Code process right now. Older Claude Code doesn't keep these
  // files: then nothing counts as ended.
  const running = runningSessions(home, options.alive)
  const tracksProcesses = existsSync(join(home, 'sessions'))

  for (const candidate of candidates(home, now)) {
    const { folder, sessionId, sessionPath, subagentsDir } = candidate
    const subagentFiles = list(subagentsDir).filter((name) => name.endsWith('.jsonl'))
    const newest = Math.max(mtime(sessionPath), ...subagentFiles.map((name) => mtime(join(subagentsDir, name))))
    const owner = running.get(sessionId)
    // A running session stays in the building however long it waits; others close after a while.
    if (now - newest > liveFor && !owner) continue
    const office = buildOffice({
      sessionId,
      sessionPath,
      folder,
      subagentsDir,
      subagentFiles,
      now,
      liveFor,
      deskFor,
      owner,
      ended: tracksProcesses && !owner,
    })
    const where = office.cwd ?? join(home, 'projects', folder)
    if (ignore.some((fragment) => where.includes(fragment) || folder.includes(fragment.replace(/\//g, '-')))) continue
    offices.push(office)
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
  /** The Claude Code process running the session, if any. */
  owner: RunningSession | undefined
  ended: boolean
}

function buildOffice(input: BuildInput): Office {
  const { sessionId, sessionPath, folder, subagentsDir, subagentFiles, now, liveFor, deskFor, owner, ended } = input
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
    ...applyStatus(stateOf({ tail: leadTail, modified, now }), leadTail, owner?.status, { modified, now, ended }),
    activity: null,
    tool: leadTail.tool,
    lastText: leadTail.lastText,
    contextTokens: leadTail.contextTokens,
    history: leadTail.history,
    updatedAt: modified,
  }

  const staff: Agent[] = []
  const interns: Agent[] = []
  let wentHome = 0
  const metas = new Map(
    subagentFiles.map((file) => {
      const path = join(subagentsDir, file)
      return [file.slice('agent-'.length, -'.jsonl'.length), readJson<Meta>(path.replace(/\.jsonl$/, '.meta.json')) ?? {}]
    }),
  )
  /** Helpers don't record their permission mode: they work in the mode of whoever started them. */
  const modeOf = (id: string, seen = new Set<string>()): string | null => {
    const meta = metas.get(id)
    if (meta?.permissionMode) return meta.permissionMode
    if (!meta?.parentAgentId || seen.has(id)) return leadTail.permissionMode
    seen.add(id)
    return modeOf(meta.parentAgentId, seen)
  }
  for (const file of subagentFiles) {
    const path = join(subagentsDir, file)
    const id = file.slice('agent-'.length, -'.jsonl'.length)
    const meta = metas.get(id) ?? {}
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
      parentId: role === 'intern' ? (meta.parentAgentId ?? sessionId) : null,
      task: meta.description ?? null,
      model: meta.model ?? tail.model,
      // Teammates run inside the lead's process: when it has ended, so has their work.
      ...applyStatus(
        stateOf({ tail, modified: updated, now, permissionMode: meta.permissionMode ?? tail.permissionMode ?? modeOf(id) }),
        tail,
        null,
        { modified: updated, now, ended },
      ),
      activity: null,
      tool: tail.tool,
      lastText: tail.lastText,
      contextTokens: tail.contextTokens,
      history: tail.history,
      updatedAt: updated,
    }
    agent.activity = activityOf(agent.state, tail)
    ;(role === 'staff' ? staff : interns).push(agent)
  }
  staff.sort((a, b) => a.name.localeCompare(b.name))
  if (manager.state === 'idle' && [...staff, ...interns].some((agent) => agent.state === 'working')) manager.rest = 'watching'
  interns.sort((a, b) => b.updatedAt - a.updatedAt)

  manager.activity = activityOf(manager.state, leadTail)
  const cwd = leadTail.cwd
  return {
    sessionId,
    project: cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? folder) : projectFromFolder(folder),
    cwd,
    title: leadTail.title,
    manager,
    staff,
    interns,
    wentHome,
    process: owner ? { pid: owner.pid, status: owner.status } : null,
    ended,
    updatedAt: Math.max(modified, ...staff.map((a) => a.updatedAt), ...interns.map((a) => a.updatedAt)),
  }
}

/** While working: the tool it's waiting on, or thinking once that tool answered. */
function activityOf(state: Agent['state'], tail: Tail): Activity | null {
  if (state !== 'working' && state !== 'waiting') return null
  return tail.step === 'calledTool' && tail.tool ? tail.tool.activity : 'thinking'
}

/** Whether a folder looks like Claude Code's. */
export function looksLikeClaudeHome(home: string): boolean {
  return existsSync(join(home, 'projects'))
}
