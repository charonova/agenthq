import type { Agent, Office } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { MANAGER_DESK, T, blockedTiles, deskOf, roomHeight, seatAt } from '../src/scene/layout'
import { findPath, nearestWalkable } from '../src/scene/path'
import { bubbleFor, planOffice } from '../src/scene/plan'

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
  updatedAt: 0,
  ...overrides,
})

function office(staff: Agent[], interns: Agent[] = [], manager: Partial<Agent> = {}): Office {
  return {
    sessionId: 's1',
    project: 'shop',
    cwd: '/Users/me/Code/shop',
    title: 'Add CSV export',
    manager: agent({ id: 's1', name: 'Manager', role: 'manager', ...manager }),
    staff,
    interns,
    wentHome: 0,
    updatedAt: 0,
  }
}

const tileOf = (x: number, y: number) => ({ tx: Math.floor(x / T), ty: Math.floor(y / T) })

describe('floor plan', () => {
  it('grows a row of desks for every five staff', () => {
    expect(roomHeight(0)).toBe(roomHeight(5))
    // Small offices keep a minimum height for the lounge; from the second row on, each row adds 4 tiles.
    expect(roomHeight(11)).toBe(roomHeight(6) + 4)
    expect(deskOf(5)).toEqual({ tx: 1, ty: deskOf(0).ty + 4 })
  })

  it('blocks desks, and side tables only where interns sit', () => {
    const core = agent({ id: 'core', name: 'core' })
    const qa = agent({ id: 'qa', name: 'qa' })
    const grid = blockedTiles(office([core, qa], [agent({ id: 'i1', role: 'intern', parentId: 'core' })]))
    const coreDesk = deskOf(0)
    const qaDesk = deskOf(1)
    expect(grid[coreDesk.ty]![coreDesk.tx]).toBe(true)
    expect(grid[coreDesk.ty]![coreDesk.tx + 2]).toBe(true) // core's interns' table
    expect(grid[qaDesk.ty]![qaDesk.tx + 2]).toBe(false) // qa has none
    expect(grid[0]![5]).toBe(true) // the wall
  })
})

describe('walking', () => {
  const grid = blockedTiles(office([agent({ id: 'core', name: 'core' }), agent({ id: 'qa', name: 'qa' })]))

  it('goes around desks, never through them', () => {
    const from = { x: 3 * T, y: 14 * T }
    const seat = seatAt(deskOf(1).tx, deskOf(1).ty)
    const path = findPath(grid, from, seat)
    expect(path.at(-1)).toEqual(seat)
    for (const point of path.slice(0, -1)) {
      const { tx, ty } = tileOf(point.x, point.y)
      expect(grid[ty]![tx]).toBe(false)
    }
  })

  it('stops at the free tile next to a seat on furniture', () => {
    const seat = seatAt(MANAGER_DESK.tx, MANAGER_DESK.ty)
    const near = nearestWalkable(grid, seat)!
    expect(grid[near.ty]![near.tx]).toBe(false)
    expect(Math.abs(near.tx - tileOf(seat.x, seat.y).tx) + Math.abs(near.ty - tileOf(seat.x, seat.y).ty)).toBeLessThanOrEqual(2)
  })

  it('leaves the glass office through its door', () => {
    const seat = seatAt(MANAGER_DESK.tx, MANAGER_DESK.ty)
    const path = findPath(grid, seat, { x: 20 * T, y: 4 * T })
    // The glass wall on the right of the office is column 7; the only way out is the gap at the bottom.
    const crossing = path.find((point) => tileOf(point.x, point.y).tx === 7)
    expect(crossing).toBeUndefined()
  })
})

describe('who goes where', () => {
  it('sends readers to the shelf, testers to the lab, and the idle to coffee and the couch', () => {
    const plans = planOffice(
      office([
        agent({
          id: 'r',
          name: 'r',
          state: 'working',
          activity: 'read',
          tool: { name: 'Read', target: 'a.ts', activity: 'read' },
        }),
        agent({
          id: 't',
          name: 't',
          state: 'working',
          activity: 'test',
          tool: { name: 'Bash', target: 'Run tests', activity: 'test' },
        }),
        agent({ id: 'c', name: 'c', state: 'idle', rest: 'coffee' }),
        agent({ id: 'z', name: 'z', state: 'idle', rest: 'couch' }),
        agent({ id: 'w', name: 'w', state: 'waiting' }),
      ]),
    )
    expect(plans.get('r')!.spot.pose).toBe('read')
    expect(plans.get('t')!.spot.y).toBeLessThan(5 * T)
    expect(plans.get('c')!.spot.pose).toBe('drink')
    expect(plans.get('z')!.spot.pose).toBe('sleep')
    expect(plans.get('w')!.spot.pose).toBe('raise')
    expect(plans.get('w')!.bubble).toBe('✋ needs you')
  })

  it('walks over to the teammate it messages, or to the lead in the glass office', () => {
    const message = (to: string) => ({ name: 'SendMessage', target: to, activity: 'message' as const })
    const plans = planOffice(
      office([
        agent({ id: 'core', name: 'core' }),
        agent({ id: 'qa', name: 'qa', state: 'working', activity: 'message', tool: message('core') }),
        agent({ id: 'ui', name: 'ui', state: 'working', activity: 'message', tool: message('main') }),
      ]),
    )
    const coreDesk = deskOf(0)
    expect(tileOf(plans.get('qa')!.spot.x, plans.get('qa')!.spot.y).ty).toBe(coreDesk.ty - 1)
    expect(plans.get('qa')!.bubble).toBe('💬 → core')
    expect(tileOf(plans.get('ui')!.spot.x, plans.get('ui')!.spot.y).tx).toBeLessThan(7) // inside the glass office
  })

  it('fills two couches, then naps by the coffee machine', () => {
    const sleepers = Array.from({ length: 8 }, (_, i) => agent({ id: `z${i}`, name: `z${i}`, state: 'idle', rest: 'couch' }))
    const poses = [...planOffice(office(sleepers)).values()].map((plan) => plan.spot.pose)
    expect(poses.filter((pose) => pose === 'sleep')).toHaveLength(6)
    expect(poses.filter((pose) => pose === 'drink')).toHaveLength(2)
  })

  it('puts interns beside the teammate who started them', () => {
    const plans = planOffice(
      office([agent({ id: 'core', name: 'core' })], [agent({ id: 'i1', role: 'intern', parentId: 'core', state: 'working' })]),
    )
    const desk = deskOf(0)
    expect(tileOf(plans.get('i1')!.spot.x, plans.get('i1')!.spot.y)).toEqual({ tx: desk.tx + 2, ty: desk.ty })
  })

  it('says nothing while sitting idle at the desk', () => {
    expect(bubbleFor(agent({ state: 'idle' }))).toBeNull()
    expect(bubbleFor(agent({ state: 'working', activity: 'thinking' }))).toBe('💭')
  })
})
