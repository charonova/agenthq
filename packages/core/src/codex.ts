import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { timing } from './state.js'
import { HISTORY, describeTool, readHeadLines, readTailLines } from './tail.js'
import type { Activity, Agent, Office, Rest, State, Step, Tool } from './types.js'

/**
 * Codex sessions as offices. Codex writes one transcript ("rollout") per thread in
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; a sub-agent's thread names its parent
 * (`parent_thread_id`), so it joins its parent's office as staff.
 */

/** Codex's folder: `CODEX_HOME`, then `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || join(homedir(), '.codex')
}

type Json = Record<string, unknown>
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function parse(line: string): Json | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? (value as Json) : null
  } catch {
    return null
  }
}

/** Who a thread is, from its first line (`session_meta`) and the first thing asked. */
export interface CodexThread {
  id: string
  cwd: string | null
  parentId: string | null
  /** A sub-agent's name ("guardian"…), when Codex gives one. */
  agentName: string | null
  title: string | null
}

export function readThread(headLines: string[]): CodexThread | null {
  let thread: CodexThread | null = null
  for (const line of headLines) {
    const entry = parse(line)
    if (!entry) continue
    const payload = (entry.payload ?? {}) as Json
    if (entry.type === 'session_meta' && !thread) {
      const id = str(payload.id) ?? str(payload.session_id)
      if (!id) return null
      const source = payload.source as Json | string | undefined
      const subagent = source && typeof source === 'object' ? (source.subagent as Json | string | undefined) : undefined
      const agentName =
        typeof subagent === 'string'
          ? subagent
          : subagent && typeof subagent === 'object'
            ? (str(subagent.other) ?? str(subagent.name))
            : null
      thread = {
        id,
        cwd: str(payload.cwd),
        parentId: str(payload.parent_thread_id),
        agentName: subagent ? (agentName ?? 'helper') : null,
        title: null,
      }
    } else if (thread && !thread.title && entry.type === 'event_msg' && payload.type === 'user_message') {
      const message = str(payload.message)
      if (message) thread.title = short(message, 60)
    }
  }
  return thread
}

/** What the end of a thread's transcript says. */
export interface CodexTail {
  working: boolean
  finishedAt: number | null
  /** It asked you something (`request_user_input_async`, an approval) and hasn't had an answer. */
  asking: boolean
  tool: Tool | null
  lastText: string | null
  model: string | null
  contextTokens: number | null
  history: Step[]
}

function short(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** A finished action, as the office shows it: where the agent goes, and a few words on the bubble. */
export function describeItem(item: Json): Tool | null {
  switch (item.type) {
    case 'CommandExecution': {
      const parsed = Array.isArray(item.parsed_cmd) ? (item.parsed_cmd as Json[]) : []
      const kind = str(parsed[0]?.type)
      const command = str(item.command) ?? ''
      if (kind === 'read')
        return {
          name: 'Read',
          target: str(parsed[0]?.name) ?? (str(parsed[0]?.path) ? basename(String(parsed[0]!.path)) : null),
          activity: 'read',
        }
      if (kind === 'search' || kind === 'list_files')
        return { name: 'Search', target: str(parsed[0]?.query) ?? str(parsed[0]?.path), activity: 'read' }
      return describeTool('Bash', { command })
    }
    case 'FileChange': {
      const changes = item.changes
      const paths = Array.isArray(changes)
        ? changes.map((change) => str((change as Json).path)).filter(Boolean)
        : changes && typeof changes === 'object'
          ? Object.keys(changes)
          : []
      return { name: 'Edit', target: paths[0] ? basename(paths[0]) : null, activity: 'edit' }
    }
    case 'McpToolCall':
      return {
        name: [str(item.server), str(item.tool)].filter(Boolean).join('.') || 'tool',
        target: str(item.tool),
        activity: 'tool',
      }
    case 'Extension':
      return { name: 'Web', target: str(item.query) ? short(String(item.query), 40) : null, activity: 'web' }
    case 'ImageView':
      return { name: 'View', target: str(item.path) ? basename(String(item.path)) : null, activity: 'read' }
    default:
      return null
  }
}

export function readCodexTail(lines: string[]): CodexTail {
  const tail: CodexTail = {
    working: false,
    finishedAt: null,
    asking: false,
    tool: null,
    lastText: null,
    model: null,
    contextTokens: null,
    history: [],
  }
  const openQuestions = new Set<string>()
  for (const line of lines) {
    const entry = parse(line)
    if (!entry) continue
    const payload = (entry.payload ?? {}) as Json
    const time = str(entry.timestamp) ? Date.parse(String(entry.timestamp)) : NaN
    if (entry.type === 'turn_context') tail.model = str(payload.model) ?? tail.model
    if (entry.type === 'event_msg') {
      switch (payload.type) {
        case 'task_started':
          tail.working = true
          tail.asking = false
          break
        case 'task_complete':
        case 'turn_aborted':
          tail.working = false
          tail.asking = false
          openQuestions.clear()
          tail.finishedAt = Number.isNaN(time) ? tail.finishedAt : time
          tail.lastText = str(payload.last_agent_message) ? short(String(payload.last_agent_message), 140) : tail.lastText
          break
        case 'token_count': {
          const last = ((payload.info as Json | undefined)?.last_token_usage ?? null) as Json | null
          const input = num(last?.input_tokens)
          // OpenAI's input count already includes the cached part.
          if (input !== null) tail.contextTokens = input
          break
        }
        case 'item_completed': {
          const item = (payload.item ?? {}) as Json
          if (item.type === 'AgentMessage') {
            const content = item.content
            const text = Array.isArray(content)
              ? content
                  .map((part) => str((part as Json).text))
                  .filter(Boolean)
                  .join(' ')
              : str(content)
            if (text) tail.lastText = short(text, 140)
          }
          const tool = describeItem(item)
          if (tool) {
            tail.tool = tool
            const at = num(payload.completed_at_ms) ?? time
            if (!Number.isNaN(at)) tail.history.push({ at, tool })
          }
          break
        }
        default:
          if (String(payload.type ?? '').includes('approval_request')) tail.asking = true
      }
    }
    if (entry.type === 'response_item') {
      const callId = str(payload.call_id)
      if (
        (payload.type === 'function_call' || payload.type === 'custom_tool_call') &&
        payload.name === 'request_user_input_async' &&
        callId
      ) {
        openQuestions.add(callId)
      }
      if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') && callId)
        openQuestions.delete(callId)
    }
  }
  if (openQuestions.size > 0) tail.asking = true
  tail.history = tail.history.slice(-HISTORY)
  return tail
}

/** A thread's state: Codex says when a turn starts and ends, so there's little to guess. */
export function codexState(
  tail: CodexTail,
  modified: number,
  now: number,
): { state: State; rest: Rest; activity: Activity | null } {
  const quiet = now - modified
  const rest: Rest = quiet >= timing.couch ? 'couch' : quiet >= timing.coffee ? 'coffee' : null
  if (tail.working || tail.asking) {
    if (tail.asking) return { state: 'waiting', rest: null, activity: null }
    // A turn that never ended (Codex was quit mid-turn) stops counting after a while.
    if (quiet < timing.thinking * 3) return { state: 'working', rest: null, activity: tail.tool?.activity ?? 'thinking' }
    return { state: 'idle', rest, activity: null }
  }
  if (tail.finishedAt !== null && now - tail.finishedAt < timing.done) return { state: 'done', rest: null, activity: null }
  return { state: 'idle', rest, activity: null }
}

export interface DiscoverCodexOptions {
  home?: string
  now?: number
  liveFor?: number
  ignore?: string[]
}

interface Rollout {
  path: string
  modified: number
}

/** Transcripts touched in the last day; the full listing is redone every 30 seconds, like Claude's. */
const candidateCache = new Map<string, { at: number; list: Rollout[] }>()

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function recentRollouts(home: string, now: number): Rollout[] {
  const cached = candidateCache.get(home)
  if (cached && now - cached.at < 30_000 && now >= cached.at) {
    return cached.list.map((rollout) => ({ ...rollout, modified: mtime(rollout.path) }))
  }
  const root = join(home, 'sessions')
  const found: Rollout[] = []
  // Folders are dated: only the last few months can hold a thread still in use.
  for (const year of list(root).sort().slice(-2)) {
    for (const month of list(join(root, year)).sort().slice(-3)) {
      for (const day of list(join(root, year, month))) {
        const dir = join(root, year, month, day)
        for (const file of list(dir)) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue
          const path = join(dir, file)
          const modified = mtime(path)
          if (now - modified < 24 * 60 * 60_000) found.push({ path, modified })
        }
      }
    }
  }
  candidateCache.set(home, { at: now, list: found })
  return found
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** Who a thread is never changes: read its head once. */
const threads = new Map<string, CodexThread | null>()

function threadOf(path: string): CodexThread | null {
  if (!threads.has(path)) {
    let thread: CodexThread | null = null
    try {
      thread = readThread(readHeadLines(path, 64 * 1024))
    } catch {
      thread = null
    }
    threads.set(path, thread)
    if (threads.size > 5000) threads.delete(threads.keys().next().value!)
  }
  return threads.get(path) ?? null
}

/**
 * Thread names, as Codex's app shows them, from `~/.codex/session_index.jsonl` (one line per
 * rename; the latest wins). Read again only when it changes. (`auth.json` next to it is Codex's
 * login: never read.)
 */
const nameCache = new Map<string, { modified: number; names: Map<string, string> }>()

export function threadNames(home: string): Map<string, string> {
  const path = join(home, 'session_index.jsonl')
  const modified = mtime(path)
  const cached = nameCache.get(home)
  if (cached && cached.modified === modified) return cached.names
  const names = new Map<string, string>()
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const entry = parse(line)
      const id = str(entry?.id)
      const name = str(entry?.thread_name)
      if (id && name) names.set(id, short(name, 60))
    }
  } catch {
    // No index: titles come from the threads themselves.
  }
  nameCache.set(home, { modified, names })
  return names
}

/** Every live Codex thread as an office: the main thread its manager, sub-agents its staff. */
export function discoverCodexOffices(options: DiscoverCodexOptions = {}): Office[] {
  const home = options.home ?? codexHome()
  const now = options.now ?? Date.now()
  const liveFor = options.liveFor ?? 30 * 60_000
  const ignore = options.ignore ?? []

  const found = recentRollouts(home, now)
    .map((rollout) => ({ ...rollout, thread: threadOf(rollout.path) }))
    .filter((rollout): rollout is Rollout & { thread: CodexThread } => rollout.thread !== null)
  const byId = new Map(found.map((rollout) => [rollout.thread.id, rollout]))
  const names = threadNames(home)

  const agentOf = (rollout: Rollout & { thread: CodexThread }, role: Agent['role']): Agent => {
    const tail = readCodexTail(readTailLines(rollout.path))
    const { state, rest, activity } = codexState(tail, rollout.modified, now)
    return {
      id: rollout.thread.id,
      name: role === 'manager' ? 'Codex' : (rollout.thread.agentName ?? 'helper'),
      role,
      color: null,
      parentId: rollout.thread.parentId,
      task: names.get(rollout.thread.id) ?? rollout.thread.title,
      model: tail.model,
      state,
      rest,
      activity,
      tool: tail.tool,
      lastText: tail.lastText,
      contextTokens: tail.contextTokens,
      history: tail.history,
      updatedAt: rollout.modified,
    }
  }

  const offices: Office[] = []
  for (const main of found) {
    if (main.thread.parentId && byId.has(main.thread.parentId)) continue // a sub-agent: staff below
    const staffRollouts = found.filter(
      (rollout) => rollout.thread.parentId === main.thread.id && now - rollout.modified <= liveFor,
    )
    const newest = Math.max(main.modified, ...staffRollouts.map((rollout) => rollout.modified))
    if (now - newest > liveFor) continue
    const where = main.thread.cwd ?? ''
    if (ignore.some((fragment) => where.includes(fragment))) continue
    const manager = agentOf(main, 'manager')
    const staff = staffRollouts.map((rollout) => agentOf(rollout, 'staff')).sort((a, b) => a.name.localeCompare(b.name))
    if (manager.state === 'idle' && staff.some((agent) => agent.state === 'working')) manager.rest = 'watching'
    offices.push({
      kind: 'codex',
      sessionId: main.thread.id,
      project: main.thread.cwd ? basename(main.thread.cwd) : 'Codex',
      cwd: main.thread.cwd,
      title: names.get(main.thread.id) ?? main.thread.title,
      manager,
      staff,
      interns: [],
      wentHome: 0,
      process: null,
      ended: false,
      updatedAt: newest,
    })
  }
  return offices
}
