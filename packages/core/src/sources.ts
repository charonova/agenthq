import { codexHome, discoverCodexOffices } from './codex.js'
import { claudeMessages, codexMessages, type Message } from './conversation.js'
import { claudeHome, discoverOffices } from './office.js'
import { replaySteps, type ReplayStep } from './replay.js'
import type { Office } from './types.js'

/**
 * Where offices come from: each agent CLI AgentHQ reads is a source, with the same few parts. To
 * add one: give it a `kind` (and add that to `Office['kind']`), find its live sessions as offices,
 * turn its transcript lines into messages and replay steps, and say how a session is resumed.
 * Sources only read their own folder; they never write to it.
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

export const sources: Record<Office['kind'], AgentSource> = {
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

/** Every source's live offices, most recently busy first. `homes` overrides a source's folder. */
export function discoverAll(options: {
  homes?: Partial<Record<Office['kind'], string>>
  ignore: string[]
  now?: number
}): Office[] {
  return Object.values(sources)
    .flatMap((source) =>
      source.discover({ home: options.homes?.[source.kind] ?? source.home(), ignore: options.ignore, now: options.now }),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
