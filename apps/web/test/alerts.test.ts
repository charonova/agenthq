import type { Agent, Office } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { detectAlerts, titleFor } from '../src/state/alerts'

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
  activity: null,
  tool: null,
  lastText: null,
  contextTokens: null,
  history: [],
  updatedAt: 0,
  ...overrides,
})

const office = (staff: Agent[], manager: Partial<Agent> = {}): Office => ({
  sessionId: 's1',
  project: 'shop',
  cwd: null,
  title: 'Add CSV export',
  manager: agent({ id: 's1', name: 'Manager', role: 'manager', ...manager }),
  staff,
  interns: [],
  wentHome: 0,
  updatedAt: 0,
})

describe('alerts', () => {
  it('rings when someone starts waiting, once', () => {
    const working = office([agent({ id: 'qa', name: 'qa' })])
    const waiting = office([
      agent({ id: 'qa', name: 'qa', state: 'waiting', tool: { name: 'Bash', target: 'rm -rf dist', activity: 'run' } }),
    ])
    const [alert] = detectAlerts([working], [waiting])
    expect(alert).toMatchObject({
      kind: 'waiting',
      agentId: 'qa',
      title: '✋ qa needs you',
      body: 'shop · Add CSV export (Bash: rm -rf dist)',
    })
    expect(detectAlerts([waiting], [waiting])).toEqual([])
  })

  it('stays quiet about whoever was already waiting when the page opened', () => {
    expect(detectAlerts(null, [office([agent({ state: 'waiting' })])])).toEqual([])
  })

  it('says when a manager finishes its turn', () => {
    const [alert] = detectAlerts([office([])], [office([], { state: 'done', lastText: 'All tests pass.' })])
    expect(alert).toMatchObject({ kind: 'finished', title: '✅ shop finished', body: 'All tests pass.' })
  })

  it('counts who needs you in the tab title', () => {
    expect(titleFor([office([agent({ state: 'waiting' }), agent({ id: 'b', state: 'waiting' })])])).toBe('(2) AgentHQ')
    expect(titleFor([])).toBe('AgentHQ')
  })
})
