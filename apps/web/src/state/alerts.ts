import type { Agent, Office } from '@agenthq/core'
import { everyone } from './store'

export interface Alert {
  kind: 'waiting' | 'finished'
  officeId: string
  agentId: string
  title: string
  body: string
}

const nameOf = (agent: Agent) =>
  agent.role === 'manager' ? 'The manager' : agent.role === 'intern' ? (agent.task ?? agent.name) : agent.name

/**
 * What changed that's worth telling you: an agent that starts waiting for you, and (optionally)
 * a session whose manager finishes its turn. Only changes: whoever was already waiting when
 * the page opened doesn't ring.
 */
export function detectAlerts(previous: Office[] | null, next: Office[]): Alert[] {
  if (previous === null) return []
  const before = new Map(
    previous.flatMap((office) => everyone(office).map((agent) => [`${office.sessionId}/${agent.id}`, agent] as const)),
  )
  const alerts: Alert[] = []
  for (const office of next) {
    const where = office.title ? `${office.project} · ${office.title}` : office.project
    for (const agent of everyone(office)) {
      const was = before.get(`${office.sessionId}/${agent.id}`)
      if (agent.state === 'waiting' && was?.state !== 'waiting') {
        const tool = agent.tool ? ` (${agent.tool.name}${agent.tool.target ? `: ${agent.tool.target}` : ''})` : ''
        alerts.push({
          kind: 'waiting',
          officeId: office.sessionId,
          agentId: agent.id,
          title: `✋ ${nameOf(agent)} needs you`,
          body: `${where}${tool}`,
        })
      }
      if (agent.role === 'manager' && agent.state === 'done' && was && was.state === 'working') {
        alerts.push({
          kind: 'finished',
          officeId: office.sessionId,
          agentId: agent.id,
          title: `✅ ${office.project} finished`,
          body: agent.lastText ?? where,
        })
      }
    }
  }
  return alerts
}

/** The tab's title: how many need you, at a glance from another tab. */
export function titleFor(offices: Office[]): string {
  const waiting = offices.flatMap(everyone).filter((agent) => agent.state === 'waiting').length
  return waiting > 0 ? `(${waiting}) AgentHQ` : 'AgentHQ'
}
