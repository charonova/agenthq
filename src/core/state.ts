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
