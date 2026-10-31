import type { Agent, Office } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { findAgents } from '../src/state/search'

// Made-up offices shaped like the ones the server sends.
const agent = (overrides: Partial<Agent>): Agent => ({
  id: 'a',
  name: 'a',
  role: 'staff',
  color: null,
  parentId: null,
  task: null,
  model: null,
  state: 'idle',
  rest: null,
  activity: null,
  tool: null,
  lastText: null,
  contextTokens: null,
  history: [],
  updatedAt: 0,
  transcript: '',
  ...overrides,
})
const office = (sessionId: string, project: string, manager: Partial<Agent>, staff: Agent[]): Office => ({
  kind: 'claude',
  sessionId,
  project,
  cwd: null,
  title: `Work on ${project}`,
  manager: agent({ id: sessionId, name: 'Manager', role: 'manager', ...manager }),
  staff,
  interns: [],
  wentHome: 0,
  process: null,
  ended: false,
  updatedAt: 0,
})

const offices = [
  office('s1', 'shop', { state: 'working' }, [
    agent({ id: 'api', name: 'api', state: 'working', tool: { name: 'Edit', target: 'export.ts', activity: 'edit' } }),
    agent({
      id: 'qa',
      name: 'qa',
      state: 'idle',
      history: [{ at: 1, tool: { name: 'Bash', target: 'pnpm vitest run', activity: 'test' } }],
    }),
  ]),
  office('s2', 'blog', { state: 'waiting' }, []),
]
const found = (query: string, filter: Parameters<typeof findAgents>[2] = 'all') =>
  findAgents(offices, query, filter).map((hit) => [hit.agent.id, hit.why])

describe('finding agents', () => {
  it('by name, project, or a file or command they touched', () => {
    expect(found('qa')).toEqual([['qa', null]])
    expect(found('export.TS')).toEqual([['api', 'Edit: export.ts']])
    expect(found('vitest')).toEqual([['qa', 'Bash: pnpm vitest run']])
    expect(found('blog')).toEqual([['s2', 'in blog']])
  })

  it('lists everyone waiting, those who need you first', () => {
    expect(found('', 'waiting')).toEqual([['s2', null]])
    expect(found('').map(([id]) => id)).toEqual(['s2', 's1', 'api', 'qa'])
    expect(found('manager', 'working')).toEqual([['s1', null]])
  })
})
