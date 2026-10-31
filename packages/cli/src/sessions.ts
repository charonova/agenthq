import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Managed } from '@agenthq/core'
import type { Query, SDKMessage, SDKUserMessage, query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { Asks, Decision } from './asks.js'

/**
 * Sessions AgentHQ runs itself, through the Claude Agent SDK and the user's own `claude`:
 * started from the page, or resumed there. Each reads the messages you send as they come; its
 * permission prompts and questions wait in the same place as the hook's, for you to answer.
 * They save their transcript like any session, so the office shows them like any other.
 */

export type Model = 'opus' | 'sonnet' | 'haiku'
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'auto'
export const models: Model[] = ['opus', 'sonnet', 'haiku']
export const modes: Mode[] = ['default', 'acceptEdits', 'plan', 'auto']

const MAX_MESSAGE = 100_000

interface Running {
  query: Query
  send: (text: string) => void
  managed: Managed
}

/** The user's Claude Code: `AGENTHQ_CLAUDE_PATH`, else `claude` on the PATH or where its installer puts it. */
export function findClaude(): string | null {
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude']
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
  ]
  const candidates = [process.env.AGENTHQ_CLAUDE_PATH, ...dirs.flatMap((dir) => names.map((name) => join(dir, name)))]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (statSync(candidate).isFile()) return realpathSync(candidate)
    } catch {
      // Not there.
    }
  }
  return null
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
  ) {}

  ids(): string[] {
    return [...this.running.keys()]
  }

  /** Whether AgentHQ runs this session, and how it's doing. */
  info(sessionId: string): Managed | null {
    return this.running.get(sessionId)?.managed ?? null
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
        // Behave as Claude Code does in a terminal: its own prompt, the user's settings and CLAUDE.md.
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
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
    this.running.set(sessionId, { query: session, send, managed })
    send(text)
    this.changed()
    void this.follow(sessionId, session, managed)
  }

  /** Reads what the session does, for whether its turn is going on, and ends it when its process does. */
  private async follow(sessionId: string, session: Query, managed: Managed) {
    try {
      for await (const message of session as AsyncIterable<SDKMessage>) {
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
      if (this.running.get(sessionId)?.query === session) this.running.delete(sessionId)
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
