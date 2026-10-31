import { randomUUID } from 'node:crypto'
import { describeTool, type Agent, type Ask, type AskAnswer, type AskQuestion, type Office } from '@agenthq/core'

/** What Claude Code hands a `PermissionRequest` hook. */
export interface HookInput {
  session_id?: string
  transcript_path?: string
  agent_id?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  permission_suggestions?: Suggestion[]
}

/** One of Claude Code's "from now on" choices, passed back as it came when you pick it. */
type Suggestion = Record<string, unknown> & { type?: string }

/** What the hook prints for Claude Code. */
export type Decision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: Suggestion[] }
  | { behavior: 'deny'; message: string }

interface Pending {
  ask: Omit<Ask, 'agentId'>
  input: HookInput
  /** From a session AgentHQ runs: nothing else can answer it, so it waits for you. */
  managed: boolean
  /** The "always" choices offered, in the order shown. */
  suggestions: Suggestion[]
  resolve: (decision: Decision | null) => void
}

/** A prompt goes stale once its transcript moves on (answered in the terminal); this long after it appeared, at the latest. */
const STALE_AFTER_WRITE = 2000
const EXPIRE = 55 * 60 * 1000
const MAX_INPUT = 4000

const where = (destination: unknown) =>
  destination === 'session' ? ' for this session' : destination === 'userSettings' ? ' everywhere' : ' in this project'

/** Claude Code's suggestion in words, or null for kinds AgentHQ doesn't offer. */
export function describeSuggestion(suggestion: Suggestion): string | null {
  const scope = where(suggestion.destination)
  if (suggestion.type === 'addRules' && suggestion.behavior !== 'deny' && suggestion.behavior !== 'ask') {
    const rules = (Array.isArray(suggestion.rules) ? suggestion.rules : []) as { toolName?: string; ruleContent?: string }[]
    if (!rules.length) return null
    return `Always allow ${rules.map((rule) => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName)).join(', ')}${scope}`
  }
  if (suggestion.type === 'addDirectories' && Array.isArray(suggestion.directories) && suggestion.directories.length) {
    return `Allow access to ${(suggestion.directories as string[]).join(', ')}${scope}`
  }
  if (suggestion.type === 'setMode' && typeof suggestion.mode === 'string') {
    return suggestion.mode === 'acceptEdits' ? `Accept all edits${scope}` : `Switch to ${suggestion.mode} mode${scope}`
  }
  return null
}

function questionsOf(input: Record<string, unknown>): AskQuestion[] {
  const list = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : []
  return list
    .filter((q) => typeof q.question === 'string')
    .map((q) => ({
      question: String(q.question),
      header: typeof q.header === 'string' ? q.header : null,
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : [])
        .filter((option) => typeof option.label === 'string')
        .map((option) => ({
          label: String(option.label),
          description: typeof option.description === 'string' ? option.description : null,
        })),
    }))
}

function inputText(input: Record<string, unknown>): string | null {
  const text =
    typeof input.command === 'string' ? input.command : Object.keys(input).length ? JSON.stringify(input, null, 2) : null
  return text && text.length > MAX_INPUT ? `${text.slice(0, MAX_INPUT)}\n…` : text
}

/** The agent a prompt belongs to: by its transcript, its agent id, else the session's manager. */
export function agentFor(input: HookInput, offices: Office[]): { office: Office; agent: Agent } | null {
  const office = offices.find((candidate) => candidate.kind === 'claude' && candidate.sessionId === input.session_id)
  if (!office) return null
  const agents = [office.manager, ...office.staff, ...office.interns]
  const agent =
    agents.find((candidate) => input.transcript_path && candidate.transcript === input.transcript_path) ??
    agents.find((candidate) => input.agent_id && candidate.id === input.agent_id) ??
    office.manager
  return { office, agent }
}

/**
 * The prompts waiting on you. Each holds its hook's request open until you answer here, the
 * terminal answers (its transcript moves on), the hook gives up, or it expires.
 */
export class Asks {
  private pending = new Map<string, Pending>()
  private offices: Office[] = []

  constructor(private readonly changed: () => void) {}

  /** A prompt from the hook; resolves with your answer, or null for "let the terminal decide". */
  add(input: HookInput, onGone: (drop: () => void) => void, managed = false): Promise<Decision | null> {
    const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}
    const name = typeof input.tool_name === 'string' ? input.tool_name : 'tool'
    const kind = name === 'AskUserQuestion' ? 'question' : 'permission'
    const offered = (Array.isArray(input.permission_suggestions) ? input.permission_suggestions : []).flatMap((suggestion) => {
      const text = describeSuggestion(suggestion)
      return text ? [{ suggestion, text }] : []
    })
    const id = randomUUID()
    return new Promise((resolve) => {
      this.pending.set(id, {
        ask: {
          id,
          sessionId: String(input.session_id ?? ''),
          kind,
          tool: describeTool(name, toolInput),
          input: kind === 'question' ? null : inputText(toolInput),
          questions: kind === 'question' ? questionsOf(toolInput) : [],
          always: kind === 'question' ? [] : offered.map((entry) => entry.text),
          at: Date.now(),
        },
        input: { ...input, tool_input: toolInput },
        managed,
        suggestions: offered.map((entry) => entry.suggestion),
        resolve,
      })
      onGone(() => this.settle(id, null))
      this.changed()
    })
  }

  /** Your answer, checked against what was asked. */
  answer(answer: AskAnswer): { ok: true; ask: Omit<Ask, 'agentId'> } | { ok: false; error: string } {
    const pending = this.pending.get(answer.id)
    if (!pending) return { ok: false, error: 'It was already answered, or it went away' }
    const { ask } = pending
    let decision: Decision
    if (answer.choice === 'deny') {
      const message = typeof answer.message === 'string' && answer.message.trim() ? answer.message.trim().slice(0, 2000) : null
      decision = { behavior: 'deny', message: message ?? 'Denied from AgentHQ.' }
    } else if (ask.kind === 'question') {
      if (answer.choice !== 'answers' || !answer.answers || typeof answer.answers !== 'object') {
        return { ok: false, error: 'Answer each question' }
      }
      const answers: Record<string, string> = {}
      for (const question of ask.questions) {
        const value = answer.answers[question.question]
        if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `No answer for “${question.question}”` }
        answers[question.question] = value.trim().slice(0, 4000)
      }
      decision = { behavior: 'allow', updatedInput: { ...pending.input.tool_input, answers } }
    } else if (answer.choice === 'once') {
      decision = { behavior: 'allow' }
    } else if (answer.choice === 'always' && Number.isInteger(answer.index) && pending.suggestions[answer.index]) {
      decision = { behavior: 'allow', updatedPermissions: [pending.suggestions[answer.index]!] }
    } else {
      return { ok: false, error: 'Not one of the choices' }
    }
    this.settle(answer.id, decision)
    return { ok: true, ask }
  }

  /** Keeps up with the offices: who asks, and which prompts the terminal answered already. */
  update(offices: Office[], now = Date.now()): void {
    this.offices = offices
    let dropped = false
    for (const [id, pending] of this.pending) {
      const found = agentFor(pending.input, offices)
      // A terminal answers on its own (the transcript moves on); a session AgentHQ runs can't.
      const moved = !pending.managed && found && found.agent.updatedAt > pending.ask.at + STALE_AFTER_WRITE
      if (moved || (!pending.managed && found?.office.ended) || now - pending.ask.at > EXPIRE) {
        this.settle(id, null, false)
        dropped = true
      }
    }
    if (dropped) this.changed()
  }

  /** The prompts to show, each with who asks. Prompts of sessions not in the office yet wait until they are. */
  list(): Ask[] {
    return [...this.pending.values()].flatMap(({ ask, input }) => {
      const found = agentFor(input, this.offices)
      return found ? [{ ...ask, agentId: found.agent.id }] : []
    })
  }

  /** Session ids with a prompt waiting whose office isn't in the building yet. */
  waitingSessions(): string[] {
    return [...this.pending.values()].filter(({ input }) => !agentFor(input, this.offices)).map(({ ask }) => ask.sessionId)
  }

  /** Lets every hook go (AgentHQ is closing): the terminal decides. */
  clear(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, null, false)
  }

  private settle(id: string, decision: Decision | null, notify = true) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.resolve(decision)
    if (notify) this.changed()
  }
}
