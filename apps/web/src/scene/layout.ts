import type { Office } from '@agenthq/core'

/**
 * The floor plan of every office, in tiles of `T` art pixels.
 *
 *   wall ───────────────── whiteboard ─ window ──────────────── wall
 *   [manager's glass office]  shelf rack lab             kitchen ☕
 *   [ desk + intern table  ]     meeting table           couch 🛋
 *   desk  desk  desk  desk  desk                         couch 🛋
 *   desk  desk  …  (5 per row; interns beside their boss)  plant
 */

export const T = 16
export const W = 28
export const PER_ROW = 5
export const DESKS_TOP = 9
export const MANAGER_DESK = { tx: 2, ty: 4 } as const
export const MANAGER_ROOM = { tx: 0, ty: 2, w: 8, h: 5 } as const

export interface Point {
  x: number
  y: number
}

/** A staff member's desk, by their place in the staff list. */
export const deskOf = (index: number) => ({ tx: 1 + (index % PER_ROW) * 4, ty: DESKS_TOP + Math.floor(index / PER_ROW) * 4 })

/** Where someone sits behind a desk whose left tile is (tx, ty): their feet, hidden by the desk. */
export const seatAt = (tx: number, ty: number): Point => ({ x: tx * T + 20, y: ty * T + 6 })

/** How many tiles tall an office with this many staff is. */
export function roomHeight(staffCount: number): number {
  const rows = Math.max(1, Math.ceil(staffCount / PER_ROW))
  return Math.max(15, DESKS_TOP + rows * 4 + 1)
}

export const door = (height: number): Point => ({ x: 7 * T + 8, y: height * T - 4 })

export const lounge = {
  couches: [
    { tx: 23, ty: 7 },
    { tx: 23, ty: 11 },
  ],
  plant: (height: number) => ({ tx: 26, ty: Math.min(14, height - 2) }),
} as const

/** Furniture along the top wall, by tile column. */
export const props = {
  bookshelf: 9,
  rack: 12,
  lab: 14,
  whiteboard: 17,
  window: 20,
  kitchen: 23,
  meetingTable: { tx: 10, ty: 5, w: 4 },
} as const

/**
 * Which tiles people can't walk through: walls, furniture, the glass office (its door is the
 * gap at the bottom right), desks, and side tables where interns sit.
 */
export function blockedTiles(office: Pick<Office, 'staff' | 'interns' | 'sessionId'>): boolean[][] {
  const height = roomHeight(office.staff.length)
  const grid = Array.from({ length: height }, (_, ty) => Array.from({ length: W }, () => ty < 2))
  const block = (tx: number, ty: number, w = 1, h = 1) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (grid[y]?.[x] !== undefined) grid[y]![x] = true
  }
  block(props.bookshelf, 2, 2)
  block(props.rack, 2)
  block(props.lab, 2, 2)
  block(props.kitchen, 2, 4)
  block(21, 2) // a plant
  // The glass office: a wall on the right and along the bottom, with a door at its bottom right.
  block(MANAGER_ROOM.w - 1, MANAGER_ROOM.ty, 1, MANAGER_ROOM.h)
  block(0, MANAGER_ROOM.ty + MANAGER_ROOM.h - 1, MANAGER_ROOM.w - 3)
  block(MANAGER_DESK.tx, MANAGER_DESK.ty, 2)
  const hasInterns = (id: string) => office.interns.some((intern) => intern.parentId === id && intern.state !== 'gone')
  if (hasInterns(office.sessionId)) block(MANAGER_DESK.tx + 2, MANAGER_DESK.ty, 2)
  block(props.meetingTable.tx, props.meetingTable.ty, props.meetingTable.w)
  for (const couch of lounge.couches) block(couch.tx, couch.ty, 4)
  const plant = lounge.plant(height)
  block(plant.tx, plant.ty)
  office.staff.forEach((agent, i) => {
    const { tx, ty } = deskOf(i)
    block(tx, ty, hasInterns(agent.id) ? 4 : 2)
  })
  return grid
}
