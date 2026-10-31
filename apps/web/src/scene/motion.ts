import type { Pose } from './art/people'
import type { Point } from './layout'

/** How people move between poses (pure: tested). */

/** Poses taken in a chair: getting there means sitting down, leaving means getting up first. */
export const SEATED = new Set<Pose>(['sit', 'type', 'raise'])
/** Seconds to sit down or get up. */
export const SIT_TIME = 0.25
/** How much lower someone sits than stands, in art pixels. */
export const SIT_DROP = 2

export interface SeatStep {
  /** 0 standing … 1 seated. */
  seat: number
  /** Whether they may walk on now (they're up). */
  walk: boolean
  pose: Pose
}

/**
 * One step of sitting down and getting up. Someone with somewhere to go gets up before walking;
 * someone who arrived at a chair sits down; halfway, they crouch. Reduced motion skips it.
 */
export function stepSeat(seat: number, person: { moving: boolean; pose: Pose }, dt: number, reduced: boolean): SeatStep {
  const wantsSeat = !person.moving && SEATED.has(person.pose)
  const target = wantsSeat ? 1 : 0
  const next =
    reduced || seat === target ? target : target > seat ? Math.min(1, seat + dt / SIT_TIME) : Math.max(0, seat - dt / SIT_TIME)
  const walk = person.moving && next === 0
  const pose: Pose =
    next > 0 && next < 1 ? 'crouch' : walk ? 'walk' : wantsSeat && next === 0 ? 'stand' : person.moving ? 'crouch' : person.pose
  return { seat: next, walk, pose }
}

/** The door stands open while anyone is close to it and on their way in or out. */
export function doorOpen(people: { x: number; y: number; moving: boolean }[], door: Point, reach = 22): boolean {
  return people.some((person) => person.moving && Math.hypot(person.x - door.x, person.y - door.y) < reach)
}
