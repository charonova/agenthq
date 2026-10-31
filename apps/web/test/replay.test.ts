import type { Agent, Office, ReplayStep } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { agentAt, officeAt } from '../src/state/replay'

const agent = (overrides: Partial<Agent>): Agent => ({
  id: 'a',
  name: 'a',
  role: 'staff',
  color: null,
  parentId: null,
  task: null,
  model: null,
  state: 'working',
  rest: null,
  activity: 'edit',
  tool: null,
  lastText: null,
  contextTokens: null,
  history: [],
  updatedAt: 0,
  transcript: '',
  ...overrides,
})
const min = 60_000
const steps: ReplayStep[] = [
  { at: 1 * min, kind: 'prompt' },
  { at: 2 * min, kind: 'tool', tool: { name: 'Read', target: 'README.md', activity: 'read' } },
  { at: 3 * min, kind: 'done' },
]

describe('the office as it was', () => {
  it('follows an agent’s steps: thinking, at the bookshelf, done, then a break', () => {
    expect(agentAt(agent({}), steps, 0)).toMatchObject({ state: 'idle', rest: null })
    expect(agentAt(agent({}), steps, 1.5 * min)).toMatchObject({ state: 'working', activity: 'thinking' })
    expect(agentAt(agent({}), steps, 2.5 * min)).toMatchObject({
      state: 'working',
      activity: 'read',
      tool: { target: 'README.md' },
    })
    expect(agentAt(agent({}), steps, 3 * min + 5000)).toMatchObject({ state: 'done' })
    expect(agentAt(agent({}), steps, 6 * min)).toMatchObject({ state: 'idle', rest: 'coffee' })
  })

  it('has helpers there only while they work', () => {
    const helper = agent({ role: 'intern' })
    expect(agentAt(helper, steps, 0).state).toBe('gone')
    expect(agentAt(helper, steps, 2.5 * min).state).toBe('working')
    expect(agentAt(helper, steps, 10 * min).state).toBe('gone')
  })

  it('rebuilds a whole office, the manager watching while the team works', () => {
    const office = {
      kind: 'claude',
      sessionId: 's',
      manager: agent({ id: 's', role: 'manager', name: 'Manager' }),
      staff: [agent({ id: 'qa', name: 'qa' })],
      interns: [],
    } as unknown as Office
    const then = officeAt(office, { sessionId: 's', from: 0, to: 10 * min, agents: [{ id: 'qa', steps }] }, 2.5 * min)
    expect(then.staff[0]).toMatchObject({ state: 'working', activity: 'read' })
    expect(then.manager).toMatchObject({ state: 'idle', rest: 'watching' })
  })
})
