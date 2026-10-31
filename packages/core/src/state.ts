import type { Rest, State, Tail } from './types.js'

/** The timings the office runs on, in milliseconds. */
export const timing = {
  /** A tool call with fresh writes is still running. */
  toolFresh: 8_000,
  /** Thinking can go a while without writing anything. */
  thinking: 10 * 60_000,
  /** "Done" shows for a moment, then the agent is idle. */
  done: 20_000,
  /** Idle this long: coffee. */
  coffee: 2 * 60_000,
  /** Idle this long: the couch. */
  couch: 15 * 60_000,
}

/** Modes in which Claude Code never stops to ask: a slow tool is just slow. */
const autonomous = new Set(['auto', 'bypassPermissions', 'acceptEdits', 'dontAsk'])

export interface StateInput {
  tail: Tail
  /** When the transcript last changed. */
  modified: number
  now: number
  /** The agent's permission mode, from its metadata or transcript. */
  permissionMode?: string | null
  /** A helper that reported it finished. */
  finished?: boolean
}

export function stateOf({ tail, modified, now, permissionMode, finished }: StateInput): { state: State; rest: Rest } {
  if (finished) return { state: 'gone', rest: null }
  const quiet = now - modified
  let state: State
  switch (tail.step) {
    case 'finished':
      state = quiet < timing.done ? 'done' : 'idle'
      break
    case 'calledTool':
      if (quiet < timing.toolFresh) state = 'working'
      else if (autonomous.has(permissionMode ?? tail.permissionMode ?? '')) state = quiet < timing.thinking ? 'working' : 'idle'
      else state = quiet < timing.couch * 2 ? 'waiting' : 'idle'
      break
    case 'awaitingModel':
      state = quiet < timing.thinking ? 'working' : 'idle'
      break
    default:
      state = 'idle'
  }
  const rest: Rest = state !== 'idle' ? null : quiet >= timing.couch ? 'couch' : quiet >= timing.coffee ? 'coffee' : null
  return { state, rest }
}

/**
 * What Claude Code itself says about a running session (`~/.claude/sessions/<pid>.json`),
 * applied to the lead's state, which is otherwise guessed from how long its transcript has been
 * quiet. Only the values seen so far count; any other leaves the guess as it is.
 *
 * - "busy": working. A tool call still unanswered is running (a slow build), not waiting for you.
 * - "idle" with a tool call unanswered: waiting for you (a permission prompt).
 * - "idle" otherwise: its turn is over.
 * - No process at all (when Claude Code keeps these files): the session ended; nobody waits.
 */
export function applyStatus(
  guess: { state: State; rest: Rest },
  tail: Tail,
  status: string | null | undefined,
  input: { modified: number; now: number; ended: boolean },
): { state: State; rest: Rest } {
  const quiet = input.now - input.modified
  const resting = (): { state: State; rest: Rest } => ({
    state: 'idle',
    rest: quiet >= timing.couch ? 'couch' : quiet >= timing.coffee ? 'coffee' : null,
  })
  if (input.ended) return guess.state === 'working' || guess.state === 'waiting' ? resting() : guess
  if (status === 'busy') return { state: 'working', rest: null }
  if (status === 'idle') {
    if (tail.step === 'calledTool') return { state: 'waiting', rest: null }
    if (guess.state === 'working' || guess.state === 'waiting') return resting()
  }
  return guess
}
