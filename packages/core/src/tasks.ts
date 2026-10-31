import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { TeamTask } from './types.js'

/**
 * A team's shared task list, as Claude Code keeps it: `~/.claude/tasks/<list>/<id>.json`, one
 * file per task. The list of a session's team is named in `~/.claude/teams/<name>/config.json`
 * (its `leadSessionId`); a session without a named team uses `session-<first 8 of its id>`.
 * Only a task's id, subject, status, owner and what blocks it are kept.
 */

type Json = Record<string, unknown>
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const statuses = new Set(['pending', 'in_progress', 'completed'])
const MAX_TASKS = 60

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

/** Lead session → team name, from the teams' configs (only `name` and `leadSessionId` are read); redone every 30 s. */
const teamCache = new Map<string, { at: number; teams: Map<string, string> }>()

export function teamsByLead(home: string, now = Date.now()): Map<string, string> {
  const cached = teamCache.get(home)
  if (cached && now - cached.at < 30_000 && now >= cached.at) return cached.teams
  const teams = new Map<string, string>()
  const dir = join(home, 'teams')
  for (const name of list(dir)) {
    try {
      const config = JSON.parse(readFileSync(join(dir, name, 'config.json'), 'utf8')) as Json
      const lead = str(config.leadSessionId)
      if (lead) teams.set(lead, str(config.name) ?? name)
    } catch {
      // No config, or half written.
    }
  }
  teamCache.set(home, { at: now, teams })
  return teams
}

/** The folder holding a session's task list. */
export function taskListOf(home: string, sessionId: string, now = Date.now()): string {
  const team = teamsByLead(home, now).get(sessionId)
  // Folder names are Claude Code's own; never a path from a file.
  const name = team && !/[\\/]|^\.\.?$/.test(team) ? team : `session-${sessionId.slice(0, 8)}`
  return join(home, 'tasks', name)
}

/** One task file, shaped like Claude Code's (`{id, subject, status, owner, blockedBy…}`); null when it isn't one. */
export function parseTask(text: string): TeamTask | null {
  let data: Json
  try {
    data = JSON.parse(text) as Json
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const id = str(data.id)
  const subject = str(data.subject)
  if (!id || !subject) return null
  const status = str(data.status)
  return {
    id,
    subject: subject.length > 90 ? subject.slice(0, 89) + '…' : subject,
    status: status && statuses.has(status) ? (status as TeamTask['status']) : 'pending',
    owner: str(data.owner),
    blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy.filter((value): value is string => typeof value === 'string') : [],
  }
}

/** Task lists by folder, read again only when the folder changes. */
const taskCache = new Map<string, { modified: number; tasks: TeamTask[] }>()

/** A session's team tasks, in id order (numbers first, as Claude Code numbers them). */
export function readTasks(home: string, sessionId: string, now = Date.now()): TeamTask[] {
  const dir = taskListOf(home, sessionId, now)
  const files = list(dir).filter((file) => file.endsWith('.json') && !file.startsWith('.'))
  const modified = Math.max(mtime(dir), ...files.map((file) => mtime(join(dir, file))))
  const cached = taskCache.get(dir)
  if (cached && cached.modified === modified) return cached.tasks
  const tasks: TeamTask[] = []
  for (const file of files.slice(0, MAX_TASKS * 2)) {
    try {
      const task = parseTask(readFileSync(join(dir, file), 'utf8'))
      if (task) tasks.push(task)
    } catch {
      // Gone, or being written.
    }
  }
  tasks.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
  const kept = tasks.slice(0, MAX_TASKS)
  taskCache.set(dir, { modified, tasks: kept })
  if (taskCache.size > 500) taskCache.delete(taskCache.keys().next().value!)
  return kept
}
