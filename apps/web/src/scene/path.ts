import { T, type Point } from './layout'

/** A tile on the grid. */
interface Tile {
  tx: number
  ty: number
}

const tileOf = (point: Point): Tile => ({ tx: Math.floor(point.x / T), ty: Math.floor(point.y / T) })
const centerOf = (tile: Tile): Point => ({ x: tile.tx * T + T / 2, y: tile.ty * T + T / 2 })
const key = (tile: Tile) => `${tile.tx},${tile.ty}`

function walkable(grid: boolean[][], tile: Tile): boolean {
  const row = grid[tile.ty]
  return row !== undefined && tile.tx >= 0 && tile.tx < row.length && !row[tile.tx]
}

/** The walkable tile closest to a point: seats and couches sit on furniture, so people stop next to them. */
export function nearestWalkable(grid: boolean[][], point: Point): Tile | null {
  const start = tileOf(point)
  if (walkable(grid, start)) return start
  // Search outward ring by ring, preferring the tile right above (in front of a desk, behind it in the picture).
  for (let radius = 1; radius < 8; radius++) {
    const ring: Tile[] = []
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        ring.push({ tx: start.tx + dx, ty: start.ty + dy })
      }
    }
    ring.sort((a, b) => distance(a, start) - distance(b, start) || a.ty - b.ty)
    const found = ring.find((tile) => walkable(grid, tile))
    if (found) return found
  }
  return null
}

const distance = (a: Tile, b: Tile) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty)

/**
 * The way from one point to another along free tiles (A*, four directions), as the points to
 * walk through: tile centers, then the exact destination. Falls back to a straight line when
 * there's no way (a closed-in spot), so nobody gets stuck.
 */
export function findPath(grid: boolean[][], from: Point, to: Point): Point[] {
  const start = nearestWalkable(grid, from)
  const goal = nearestWalkable(grid, to)
  if (!start || !goal) return [to]
  if (key(start) === key(goal)) return [to]

  const open = new Map<string, Tile>([[key(start), start]])
  const came = new Map<string, string>()
  const cost = new Map<string, number>([[key(start), 0]])
  const score = new Map<string, number>([[key(start), distance(start, goal)]])
  const tiles = new Map<string, Tile>([[key(start), start]])

  while (open.size > 0) {
    let currentKey = ''
    let best = Infinity
    for (const [k] of open) {
      const s = score.get(k) ?? Infinity
      if (s < best) {
        best = s
        currentKey = k
      }
    }
    const current = open.get(currentKey)!
    if (currentKey === key(goal)) return reconstruct(came, tiles, currentKey, to)
    open.delete(currentKey)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { tx: current.tx + dx, ty: current.ty + dy }
      if (!walkable(grid, next)) continue
      const nextKey = key(next)
      const tentative = (cost.get(currentKey) ?? Infinity) + 1
      if (tentative < (cost.get(nextKey) ?? Infinity)) {
        came.set(nextKey, currentKey)
        cost.set(nextKey, tentative)
        score.set(nextKey, tentative + distance(next, goal))
        tiles.set(nextKey, next)
        open.set(nextKey, next)
      }
    }
  }
  return [to]
}

function reconstruct(came: Map<string, string>, tiles: Map<string, Tile>, end: string, to: Point): Point[] {
  const keys = [end]
  let current = end
  while (came.has(current)) {
    current = came.get(current)!
    keys.unshift(current)
  }
  // Skip the tile the walk starts on, and points in a straight line with their neighbours.
  const points = keys.slice(1).map((k) => centerOf(tiles.get(k)!))
  const simplified = points.filter((point, i) => {
    const before = points[i - 1]
    const after = points[i + 1]
    if (!before || !after) return true
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
  })
  return [...simplified, to]
}
