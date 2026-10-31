import type { Agent, Office } from '@agenthq/core'

/** Finding agents across the building: by name, task, project, or a file or command they touched (pure: tested). */

export type Filter = 'all' | 'waiting' | 'working' | 'resting'

export interface Hit {
  office: Office
  agent: Agent
  /** What matched, when it isn't their name: "file export.ts", "task …". */
  why: string | null
}

const filters: Record<Filter, (agent: Agent) => boolean> = {
  all: (agent) => agent.state !== 'gone',
  waiting: (agent) => agent.state === 'waiting',
  working: (agent) => agent.state === 'working',
  resting: (agent) => agent.state === 'idle' || agent.state === 'done',
}

const nameOf = (agent: Agent) => (agent.role === 'intern' ? (agent.task ?? agent.name) : agent.name)

/** Agents matching a search and a filter, those who need you first. An empty search lists everyone the filter keeps. */
export function findAgents(offices: Office[], query: string, filter: Filter, limit = 40): Hit[] {
  const needle = query.trim().toLowerCase()
  const has = (text: string | null | undefined) => !!text && text.toLowerCase().includes(needle)
  const hits: Hit[] = []
  for (const office of offices) {
    for (const agent of [office.manager, ...office.staff, ...office.interns]) {
      if (!filters[filter](agent)) continue
      if (!needle) {
        hits.push({ office, agent, why: null })
        continue
      }
      if (has(nameOf(agent)) || (agent.role === 'manager' && has('manager'))) hits.push({ office, agent, why: null })
      else if (has(office.project) || has(office.title)) hits.push({ office, agent, why: `in ${office.project}` })
      else if (has(agent.task)) hits.push({ office, agent, why: `task: ${agent.task}` })
      else {
        // A file, a command or a search it touched lately.
        const step = [agent.tool, ...[...agent.history].reverse().map((step) => step.tool)].find((tool) => has(tool?.target))
        if (step?.target) hits.push({ office, agent, why: `${step.name}: ${step.target}` })
      }
    }
  }
  const rank = (hit: Hit) => (hit.agent.state === 'waiting' ? 0 : hit.agent.state === 'working' ? 1 : 2)
  return hits.sort((a, b) => rank(a) - rank(b)).slice(0, limit)
}
