import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { Draft, Managed } from '@agenthq/core'
import type { Query, SDKMessage, SDKUserMessage, query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { Asks, Decision } from './asks.js'

/**
 * Sessions AgentHQ runs itself, through the Claude Agent SDK and the user's own `claude`:
 * started from the page, or resumed there. Each reads the messages you send as they come; its
 * permission prompts and questions wait in the same place as the hook's, for you to answer.
 * They save their transcript like any session, so the office shows them like any other; the
 * reply being written streams to the page before the transcript has it.
 */

export type Model = 'opus' | 'sonnet' | 'haiku'
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'auto'
export const models: Model[] = ['opus', 'sonnet', 'haiku']
export const modes: Mode[] = ['default', 'acceptEdits', 'plan', 'auto']

const MAX_MESSAGE = 100_000
/** A finished draft stays this long, for its transcript line to land, then goes. */
const DRAFT_KEEP = 20_000

interface Running {
  query: Query
  send: (text: string) => void
  managed: Managed
  draft: Draft | null
}

/**
 * What an npm shim on Windows (`claude.cmd`) runs: the script or program it names next to
 * itself (`"%dp0%\node_modules\@anthropic-ai\claude-code\cli.js"`), as a path in `dir`.
 */
export function shimTarget(text: string, dir: string): string | null {
  const named = [...text.matchAll(/"%~?dp0%?\\?([^"%]+\.(?:js|mjs|cjs|exe))"/gi)].map((match) => match[1]!)
  const target = named.find((name) => !/(^|\\)node\.exe$/i.test(name))
  return target ? join(dir, ...target.split(/[\\/]/).filter(Boolean)) : null
}

/** A candidate as the SDK can run it: a program, or (behind an npm shim) the script node runs. */
function runnable(candidate: string): string | null {
  if (!statSync(candidate).isFile()) return null
  if (!/\.cmd$/i.test(candidate)) return realpathSync(candidate)
  // A .cmd can't be run without a shell: run what it would run instead.
  const target = shimTarget(readFileSync(candidate, 'utf8'), dirname(candidate))
  return target && statSync(target).isFile() ? realpathSync(target) : null
}

/**
 * The user's Claude Code: `AGENTHQ_CLAUDE_PATH`, else `claude` on the PATH or where its installer
 * puts it. On Windows that's `claude.exe` (the installer) or npm's `claude.cmd`, whose `cli.js`
 * then runs with node.
 */
export function findClaude(platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
  ]
  const candidates = [process.env.AGENTHQ_CLAUDE_PATH, ...dirs.flatMap((dir) => names.map((name) => join(dir, name)))]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const found = runnable(candidate)
      if (found) return found
    } catch {
      // Not there.
    }
  }
  return null
}

/**
 * What a message from the session does to the reply being written (the lead's only, not its
 * helpers'): a block of text starts one, its deltas add to it, and it's final once the block,
 * the message or the turn ends.
 */
export function nextDraft(draft: Draft | null, message: SDKMessage, now: number): Draft | null {
  const finish = () => (draft && !draft.final ? { ...draft, final: true } : draft)
  if (message.type === 'result') return finish()
  if (message.type === 'assistant') return message.parent_tool_use_id === null ? finish() : draft
  if (message.type !== 'stream_event' || message.parent_tool_use_id !== null) return draft
  const event = message.event
  switch (event.type) {
    case 'content_block_start':
      return event.content_block.type === 'text'
        ? { id: message.uuid, text: event.content_block.text ?? '', startedAt: now, final: false }
        : finish()
    case 'content_block_delta':
      return draft && !draft.final && event.delta.type === 'text_delta'
        ? { ...draft, text: draft.text + event.delta.text }
        : draft
    case 'content_block_stop':
    case 'message_stop':
      return finish()
    default:
      return draft
  }
}

/** A queue the session reads from: each message you send, when you send it. */
function inbox(): { messages: AsyncIterable<SDKUserMessage>; send: (text: string) => void } {
  const queue: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  return {
    send: (text) => {
      queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
      wake?.()
      wake = null
    },
    messages: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (queue.length) yield queue.shift()!
          await new Promise<void>((resolve) => (wake = resolve))
        }
      },
    },
  }
}

export class Sessions {
  private running = new Map<string, Running>()

  constructor(
    private readonly asks: Asks,
    private readonly changed: () => void,
    /** The reply being written changed (null: there's none anymore). */
    private readonly drafted: (sessionId: string, draft: Draft | null) => void = () => {},
  ) {}

  ids(): string[] {
    return [...this.running.keys()]
  }

  /** Whether AgentHQ runs this session, and how it's doing. */
  info(sessionId: string): Managed | null {
    return this.running.get(sessionId)?.managed ?? null
  }

  /** Every reply being written now, by session. */
  drafts(): Record<string, Draft> {
    const drafts: Record<string, Draft> = {}
    for (const [id, session] of this.running) if (session.draft) drafts[id] = session.draft
    return drafts
  }

  /** Starts a session in a folder with your first message. */
  async start(options: { cwd: string; prompt: string; model?: Model | null; mode?: Mode | null }): Promise<string> {
    const cwd = options.cwd.trim()
    if (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('Pick a folder that exists')
    const sessionId = randomUUID()
    await this.run(sessionId, cwd, options.prompt, { sessionId, model: options.model, mode: options.mode })
    return sessionId
  }

  /** Continues a session that isn't running anywhere, here, with your next message. */
  async resume(sessionId: string, cwd: string, prompt: string): Promise<void> {
    if (this.running.has(sessionId)) return this.send(sessionId, prompt)
    await this.run(sessionId, cwd, prompt, { resume: sessionId })
  }

  send(sessionId: string, text: string): void {
    const session = this.running.get(sessionId)
    if (!session) throw new Error('AgentHQ doesn’t run this session')
    session.send(checked(text))
    session.managed.busy = true
    this.changed()
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.running.get(sessionId)
    if (!session) throw new Error('AgentHQ doesn’t run this session')
    await session.query.interrupt()
  }

  /** Ends a session: its process stops, and its prompts go away. */
  stop(sessionId: string): void {
    const session = this.running.get(sessionId)
    if (!session) return
    this.running.delete(sessionId)
    session.query.close()
    if (session.draft) this.drafted(sessionId, null)
    this.changed()
  }

  closeAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }

  private async run(
    sessionId: string,
    cwd: string,
    prompt: string,
    how: { sessionId?: string; resume?: string; model?: Model | null; mode?: Mode | null },
  ) {
    const text = checked(prompt)
    if (how.model && !models.includes(how.model)) throw new Error('Unknown model')
    if (how.mode && !modes.includes(how.mode)) throw new Error('Unknown permission mode')
    const query = await loadQuery()
    const claude = process.env.AGENTHQ_TEST_AGENT ? undefined : (findClaude() ?? undefined)
    if (!claude && !process.env.AGENTHQ_TEST_AGENT)
      throw new Error('Claude Code wasn’t found: install it, or set AGENTHQ_CLAUDE_PATH')
    const { messages, send } = inbox()
    // A session started from inside another Claude Code session would otherwise not save its transcript.
    const env: Record<string, string | undefined> = { ...process.env, AGENTHQ_MANAGED: '1' }
    delete env.CLAUDE_CODE_CHILD_SESSION
    delete env.CLAUDECODE
    const managed: Managed = { busy: true, error: null }
    const session = query({
      prompt: messages,
      options: {
        cwd,
        env,
        pathToClaudeCodeExecutable: claude,
        // An npm install is a script: node runs it (the SDK runs anything not ending in .js as a program).
        ...(claude && /\.[cm]?js$/.test(claude) ? { executable: 'node' as const } : {}),
        // Behave as Claude Code does in a terminal: its own prompt, the user's settings and CLAUDE.md.
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        // The reply as it's written, for the page to show before the transcript has it.
        includePartialMessages: true,
        permissionMode: how.mode ?? 'default',
        ...(how.model ? { model: how.model } : {}),
        ...(how.sessionId ? { sessionId: how.sessionId } : {}),
        ...(how.resume ? { resume: how.resume } : {}),
        canUseTool: async (toolName, input, { signal, suggestions, agentID }) => {
          const decision = await this.asks.add(
            {
              session_id: sessionId,
              ...(agentID ? { agent_id: agentID } : {}),
              tool_name: toolName,
              tool_input: input,
              permission_suggestions: suggestions as Record<string, unknown>[] | undefined,
            },
            (drop) => signal.addEventListener('abort', drop),
            true,
          )
          return toResult(decision)
        },
      },
    })
    const running: Running = { query: session, send, managed, draft: null }
    this.running.set(sessionId, running)
    send(text)
    this.changed()
    void this.follow(sessionId, running)
  }

  /** Keeps the reply being written, and drops a finished one once its transcript line has had time to land. */
  private draft(sessionId: string, running: Running, message: SDKMessage) {
    const draft = nextDraft(running.draft, message, Date.now())
    if (draft === running.draft) return
    running.draft = draft
    this.drafted(sessionId, draft)
    if (draft?.final) {
      setTimeout(() => {
        if (running.draft !== draft) return
        running.draft = null
        if (this.running.get(sessionId) === running) this.drafted(sessionId, null)
      }, DRAFT_KEEP).unref?.()
    }
  }

  /** Reads what the session does, for whether its turn is going on, and ends it when its process does. */
  private async follow(sessionId: string, running: Running) {
    const { query: session, managed } = running
    try {
      for await (const message of session as AsyncIterable<SDKMessage>) {
        this.draft(sessionId, running, message)
        if (message.type === 'result') {
          managed.busy = false
          managed.error =
            message.subtype === 'success' ? null : ('errors' in message && message.errors?.join('; ')) || 'The turn stopped'
          this.changed()
        }
      }
    } catch (error) {
      managed.error = (error as Error).message
    } finally {
      if (this.running.get(sessionId) === running) {
        this.running.delete(sessionId)
        if (running.draft) this.drafted(sessionId, null)
      }
      managed.busy = false
      this.changed()
    }
  }
}

function checked(text: string): string {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) throw new Error('Write a message first')
  if (trimmed.length > MAX_MESSAGE) throw new Error('That message is too long')
  return trimmed
}

function toResult(decision: Decision | null) {
  if (!decision) return { behavior: 'deny' as const, message: 'No answer from AgentHQ.' }
  if (decision.behavior === 'deny') return decision
  return {
    behavior: 'allow' as const,
    ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
    ...(decision.updatedPermissions ? { updatedPermissions: decision.updatedPermissions as never } : {}),
  }
}

/** The SDK, loaded on first use (it's most of AgentHQ's size); tests can stand in for it. */
async function loadQuery(): Promise<typeof sdkQuery> {
  if (process.env.AGENTHQ_TEST_AGENT) {
    return ((await import(process.env.AGENTHQ_TEST_AGENT)) as { query: typeof sdkQuery }).query
  }
  return (await import('@anthropic-ai/claude-agent-sdk')).query
}
