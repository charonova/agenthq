// Pixel art drawn in code, from small rectangles: nothing to licence, and every agent can look a
// little different. Coordinates are art pixels, drawn one canvas pixel each; the scene scales
// them up with nearest-neighbour filtering, so they stay crisp at any zoom.

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

/** A stable number for a text: the same name always gets the same look. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function darker(hex: string, amount = 0.25): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * (1 - amount))
  const g = Math.round(((n >> 8) & 255) * (1 - amount))
  const b = Math.round((n & 255) * (1 - amount))
  return `rgb(${r},${g},${b})`
}
