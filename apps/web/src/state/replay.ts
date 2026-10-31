import type { Agent, Office, Replay, ReplayStep } from '@agenthq/core'
import { create } from 'zustand'
import { useToast } from './jump'

/**
 * Replaying a session's last hours as a time-lapse: the office as it was at any moment, rebuilt
 * from its agents' steps and drawn by the same scene, so people walk between places as time
 * runs (pure parts tested).
 */

/** After a tool call this long ago with nothing since, it was waiting or idle, not working. */
const STILL_WORKING = 10 * 60_000
const DONE_FOR = 20_000

/** What an agent was doing at `t`, from its steps (oldest first). */
export function agentAt(agent: Agent, steps: ReplayStep[], t: number): Agent {
  let last: ReplayStep | undefined
  for (const step of steps) {
    if (step.at > t) break
    last = step
  }
  const quiet = last ? t - last.at : Number.POSITIVE_INFINITY
  const rest = (): Agent['rest'] => (quiet >= 15 * 60_000 ? 'couch' : quiet >= 2 * 60_000 ? 'coffee' : null)
  const base = { ...agent, waitingFor: null, history: [] }
  // A helper is there only while it works: from its first step to a little after its last.
  if (agent.role === 'intern' && (!last || (steps.at(-1) === last && quiet > 60_000)))
    return { ...base, state: 'gone', rest: null }
  if (!last || quiet > STILL_WORKING) return { ...base, state: 'idle', rest: last ? rest() : null, activity: null }
  switch (last.kind) {
    case 'tool':
      return { ...base, state: 'working', rest: null, activity: last.tool?.activity ?? 'tool', tool: last.tool ?? null }
    case 'done':
      return quiet < DONE_FOR
        ? { ...base, state: 'done', rest: null, activity: null }
        : { ...base, state: 'idle', rest: rest(), activity: null }
    default:
      return { ...base, state: 'working', rest: null, activity: 'thinking' }
  }
}

/** The office as it was at `t`. */
export function officeAt(office: Office, replay: Replay, t: number): Office {
  const steps = new Map(replay.agents.map((agent) => [agent.id, agent.steps]))
  const at = (agent: Agent) => agentAt(agent, steps.get(agent.id) ?? [], t)
  const manager = at(office.manager)
  const staff = office.staff.map(at)
  const interns = office.interns.map(at)
  if (manager.state === 'idle' && [...staff, ...interns].some((agent) => agent.state === 'working')) manager.rest = 'watching'
  return { ...office, manager, staff, interns, managed: null, ended: false, talks: [] }
}

/** The offices to draw: live ones, with the replayed one as it was. */
export function withReplay(offices: Office[], replay: ReplayState): Office[] {
  if (!replay.data) return offices
  return offices.map((office) =>
    office.sessionId === replay.data!.sessionId ? officeAt(office, replay.data!, replay.t) : office,
  )
}

interface ReplayState {
  data: Replay | null
  t: number
  playing: boolean
  /** Seconds of the session per second of replay. */
  speed: number
}

export const speeds = [60, 300, 1200]

export const useReplay = create<ReplayState>()(() => ({ data: null, t: 0, playing: false, speed: 300 }))

let timer: number | null = null

/** Loads a session's last hours and starts playing them from the beginning. */
export async function startReplay(sessionId: string, hours = 2): Promise<void> {
  try {
    const response = await fetch(`/api/replay?${new URLSearchParams({ session: sessionId, hours: String(hours) })}`, {
      headers: { 'X-AgentHQ': '1' },
    })
    const data = (await response.json()) as Replay & { error?: string }
    if (!response.ok) throw new Error(data.error ?? response.statusText)
    const first = Math.min(...data.agents.flatMap((agent) => agent.steps.map((step) => step.at)), data.to)
    // Start a little before the first thing that happened in the window.
    useReplay.setState({ data, t: Math.max(data.from, first - 60_000), playing: true })
    play()
  } catch (error) {
    useToast.getState().show(`Couldn’t load the replay: ${(error as Error).message}`, 'error')
  }
}

export function stopReplay(): void {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  useReplay.setState({ data: null, playing: false })
}

/** Time runs at the chosen speed, ten steps a second, until the end of the window. */
export function play(): void {
  if (timer !== null) window.clearInterval(timer)
  timer = window.setInterval(() => {
    const { data, t, playing, speed } = useReplay.getState()
    if (!data || !playing) return
    const next = Math.min(data.to, t + speed * 100)
    useReplay.setState({ t: next, playing: next < data.to })
  }, 100)
}
