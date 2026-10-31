import { codexHome, discoverCodexOffices } from './codex.js'
import { claudeMessages, codexMessages, type Message } from './conversation.js'
import { claudeHome, discoverOffices } from './office.js'
import { replaySteps, type ReplayStep } from './replay.js'
import type { Office } from './types.js'

/**
 * Where offices come from: each agent CLI AgentHQ reads is a source, with the same few parts:
 * a `kind`, its live sessions as offices, its transcript lines as messages and replay steps, and
 * how a session is resumed. Claude Code and Codex are built in; plugins add more
 * (`registerSource`, docs/plugins.md). Sources only read their own folder; they never write to it.
 */
export interface AgentSource {
  kind: Office['kind']
  /** Its name, as the page shows it ("Codex"). */
  label: string
  /** Its folder, from the environment (`CODEX_HOME`…). */
  home: (env?: NodeJS.ProcessEnv) => string
  /** Its live sessions, as offices. */
  discover: (options: { home: string; ignore: string[]; now?: number }) => Office[]
  /** Transcript lines as a conversation. */
  messages: (lines: string[]) => Message[]
  /** Transcript lines as replay steps, from `since` on. */
  steps: (lines: string[], since: number) => ReplayStep[]
  /** The command that resumes a session in a terminal (the folder comes first, separately). */
  resume: (sessionId: string) => string
}

export const sources: Record<'claude' | 'codex', AgentSource> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    home: claudeHome,
    discover: ({ home, ignore, now }) => discoverOffices({ home, ignore, now }),
    messages: claudeMessages,
    steps: (lines, since) => replaySteps(lines, 'claude', since),
    resume: (sessionId) => `claude --resume ${sessionId}`,
  },
  codex: {
    kind: 'codex',
    label: 'Codex',
    home: codexHome,
    discover: ({ home, ignore, now }) => discoverCodexOffices({ home, ignore, now }),
    messages: codexMessages,
    steps: (lines, since) => replaySteps(lines, 'codex', since),
    resume: (sessionId) => `codex resume ${sessionId}`,
  },
}

/** Every source, built in or from a plugin, by kind. */
const registry = new Map<string, AgentSource>(Object.entries(sources))

export function sourceOf(kind: string): AgentSource | undefined {
  return registry.get(kind)
}

/**
 * Adds a plugin's source. Its kind must be new and plain (`gemini`, `my-agent`); a source missing a
 * part is refused. Returns why when it's refused.
 */
export function registerSource(source: unknown): string | null {
  const candidate = source as Partial<AgentSource> | null
  if (!candidate || typeof candidate !== 'object') return 'not a source'
  if (typeof candidate.kind !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(candidate.kind))
    return 'its kind must be like "my-agent"'
  if (registry.has(candidate.kind)) return `a source of kind "${candidate.kind}" is already there`
  if (typeof candidate.label !== 'string' || !candidate.label.trim()) return 'it needs a label'
  for (const part of ['home', 'discover', 'messages', 'steps', 'resume'] as const) {
    if (typeof candidate[part] !== 'function') return `it needs ${part}()`
  }
  registry.set(candidate.kind, candidate as AgentSource)
  return null
}

/** Takes a plugin's source out again (tests). */
export function unregisterSource(kind: string): void {
  if (kind !== 'claude' && kind !== 'codex') registry.delete(kind)
}

/** Whether a plugin's office has what the office needs to show it. */
function looksLikeOffice(office: unknown): office is Office {
  const value = office as Partial<Office> | null
  return (
    !!value &&
    typeof value.sessionId === 'string' &&
    typeof value.project === 'string' &&
    !!value.manager &&
    Array.isArray(value.staff) &&
    Array.isArray(value.interns) &&
    typeof value.updatedAt === 'number'
  )
}

/**
 * Every source's live offices, most recently busy first. `homes` overrides a source's folder. A
 * plugin that throws or returns something else is left out; the built-in sources' offices stay.
 */
export function discoverAll(options: { homes?: Partial<Record<string, string>>; ignore: string[]; now?: number }): Office[] {
  return [...registry.values()]
    .flatMap((source) => {
      const home = options.homes?.[source.kind] ?? source.home()
      if (source.kind === 'claude' || source.kind === 'codex')
        return source.discover({ home, ignore: options.ignore, now: options.now })
      try {
        const found: unknown = source.discover({ home, ignore: options.ignore, now: options.now })
        return (Array.isArray(found) ? found : [])
          .filter(looksLikeOffice)
          .map((office) => ({ ...office, kind: source.kind, label: source.label }))
      } catch {
        return []
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
