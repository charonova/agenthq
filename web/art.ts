// Pixel art drawn in code: furniture and people from small rectangles, so nothing needs a
// licence and every agent can look a little different. Coordinates are art pixels; one art
// pixel is `S` canvas pixels, which keeps text sharp while the art stays chunky.

export const S = 3
export const T = 16 // art pixels per tile

export type Ctx = CanvasRenderingContext2D

export function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x) * S, Math.round(y) * S, Math.round(w) * S, Math.round(h) * S)
}

// ── Looks ────────────────────────────────────────────────────────────────────

const skins = ['#f6d5b5', '#e9b98f', '#d19a6a', '#a8714a', '#7a4e2f', '#5a3a24']
const hairColors = ['#2b1d14', '#4a2f1f', '#8a5a2b', '#d9a441', '#1f1f24', '#a83a2a', '#6b6b78']
const shirts = ['#4f7dd6', '#d65f5f', '#57a85f', '#d9a441', '#8d63c9', '#2fa3a3', '#e07a3f', '#c75a9e']

/** Claude Code's team colours, as shirts. */
const teamColors: Record<string, string> = {
  red: '#d65f5f',
  orange: '#e07a3f',
  yellow: '#d9b441',
  green: '#57a85f',
  blue: '#4f7dd6',
  purple: '#8d63c9',
  pink: '#d96fa8',
  cyan: '#2fa3a3',
}

export type HairStyle = 'short' | 'spiky' | 'buzz' | 'long' | 'bun' | 'ponytail' | 'bob' | 'curly'
const styles: HairStyle[] = ['short', 'spiky', 'buzz', 'long', 'bun', 'ponytail', 'bob', 'curly']

export interface Look {
  skin: string
  hair: string
  style: HairStyle
  shirt: string
  /** The manager wears a suit and tie; interns a badge. */
  outfit: 'suit' | 'casual' | 'intern'
}

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The same name always gets the same person. */
export function lookFor(name: string, color: string | null, role: 'manager' | 'staff' | 'intern'): Look {
  const h = hash(name)
  return {
    skin: skins[h % skins.length]!,
    hair: hairColors[(h >>> 3) % hairColors.length]!,
    style: styles[(h >>> 7) % styles.length]!,
    shirt: role === 'manager' ? '#2c3550' : (color && teamColors[color]) || shirts[(h >>> 11) % shirts.length]!,
    outfit: role === 'manager' ? 'suit' : role === 'intern' ? 'intern' : 'casual',
  }
}

// ── People ───────────────────────────────────────────────────────────────────

export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'raise' | 'drink' | 'sleep' | 'read'

const darker = (hex: string, amount = 0.25): string => {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * (1 - amount))
  const g = Math.round(((n >> 8) & 255) * (1 - amount))
  const b = Math.round((n & 255) * (1 - amount))
  return `rgb(${r},${g},${b})`
}

/** A person 12×20 art pixels, standing on (x, y): x is the middle, y the floor under their feet. */
export function drawPerson(ctx: Ctx, look: Look, x: number, y: number, pose: Pose, frame: number): void {
  if (pose === 'sleep') return drawSleeper(ctx, look, x, y, frame)
  const ox = Math.round(x) - 6
  const oy = Math.round(y) - 20
  const pants = look.outfit === 'suit' ? '#1e2436' : '#34405a'
  const shoes = '#1b1b22'

  // Legs: a step while walking.
  const step = pose === 'walk' ? frame % 2 : -1
  px(ctx, pants, ox + 3, oy + 15, 2, step === 0 ? 3 : 4)
  px(ctx, pants, ox + 7, oy + 15, 2, step === 1 ? 3 : 4)
  px(ctx, shoes, ox + 2, oy + (step === 0 ? 18 : 19), 3, 1)
  px(ctx, shoes, ox + 7, oy + (step === 1 ? 18 : 19), 3, 1)

  // Body and arms.
  px(ctx, look.shirt, ox + 2, oy + 9, 8, 6)
  px(ctx, darker(look.shirt, 0.18), ox + 2, oy + 14, 8, 1)
  if (look.outfit === 'suit') {
    px(ctx, '#ffffff', ox + 5, oy + 9, 2, 3)
    px(ctx, '#c0392b', ox + 5, oy + 10, 2, 4)
  }
  if (look.outfit === 'intern') px(ctx, '#f1c40f', ox + 3, oy + 11, 2, 2)

  const arm = darker(look.shirt, 0.1)
  if (pose === 'raise') {
    px(ctx, arm, ox + 1, oy + 9, 1, 5)
    px(ctx, look.skin, ox + 1, oy + 14, 1, 1)
    px(ctx, arm, ox + 10, oy + 3 - (frame % 2), 1, 7)
    px(ctx, look.skin, ox + 10, oy + 1 - (frame % 2), 2, 2)
  } else if (pose === 'type') {
    // Hands on the keyboard, taking turns.
    px(ctx, arm, ox + 1, oy + 9, 1, 4)
    px(ctx, arm, ox + 10, oy + 9, 1, 4)
    px(ctx, look.skin, ox + 2, oy + 12 + (frame % 2), 2, 1)
    px(ctx, look.skin, ox + 8, oy + 13 - (frame % 2), 2, 1)
  } else if (pose === 'drink') {
    px(ctx, arm, ox + 1, oy + 9, 1, 5)
    px(ctx, look.skin, ox + 1, oy + 14, 1, 1)
    px(ctx, arm, ox + 10, oy + 9, 1, 3)
    px(ctx, look.skin, ox + 9, oy + 11, 2, 1)
    px(ctx, '#f4f4f4', ox + 9, oy + 8 + (frame % 2), 3, 3) // the cup comes up for a sip
    px(ctx, '#6f4a2a', ox + 9, oy + 8 + (frame % 2), 3, 1)
  } else if (pose === 'read') {
    px(ctx, arm, ox + 1, oy + 9, 1, 3)
    px(ctx, arm, ox + 10, oy + 9, 1, 3)
    px(ctx, '#e9e1c9', ox + 2, oy + 11, 8, 3) // an open book
    px(ctx, '#b33a3a', ox + 5, oy + 11, 2, 3)
  } else {
    px(ctx, arm, ox + 1, oy + 9, 1, 5)
    px(ctx, arm, ox + 10, oy + 9, 1, 5)
    px(ctx, look.skin, ox + 1, oy + 14, 1, 1)
    px(ctx, look.skin, ox + 10, oy + 14, 1, 1)
  }

  // Neck, head, face.
  px(ctx, look.skin, ox + 5, oy + 8, 2, 1)
  px(ctx, look.skin, ox + 3, oy + 2, 6, 6)
  const blink = frame % 7 === 0
  px(ctx, '#1b1b22', ox + 4, oy + 5, 1, blink ? 0.34 : 1)
  px(ctx, '#1b1b22', ox + 7, oy + 5, 1, blink ? 0.34 : 1)
  px(ctx, darker(look.skin, 0.25), ox + 5, oy + 7, 2, 1)
  drawHair(ctx, look, ox, oy)
}

function drawHair(ctx: Ctx, look: Look, ox: number, oy: number): void {
  const h = look.hair
  switch (look.style) {
    case 'buzz':
      px(ctx, h, ox + 3, oy + 1, 6, 2)
      break
    case 'spiky':
      px(ctx, h, ox + 3, oy + 1, 6, 2)
      px(ctx, h, ox + 3, oy + 0, 1, 1)
      px(ctx, h, ox + 5, oy - 1, 1, 2)
      px(ctx, h, ox + 7, oy + 0, 1, 1)
      px(ctx, h, ox + 2, oy + 2, 1, 2)
      px(ctx, h, ox + 9, oy + 2, 1, 2)
      break
    case 'long':
      px(ctx, h, ox + 2, oy + 1, 8, 3)
      px(ctx, h, ox + 2, oy + 4, 1, 7)
      px(ctx, h, ox + 9, oy + 4, 1, 7)
      break
    case 'bob':
      px(ctx, h, ox + 2, oy + 1, 8, 3)
      px(ctx, h, ox + 2, oy + 4, 1, 4)
      px(ctx, h, ox + 9, oy + 4, 1, 4)
      break
    case 'bun':
      px(ctx, h, ox + 2, oy + 1, 8, 3)
      px(ctx, h, ox + 4, oy - 2, 4, 3)
      px(ctx, h, ox + 2, oy + 4, 1, 2)
      px(ctx, h, ox + 9, oy + 4, 1, 2)
      break
    case 'ponytail':
      px(ctx, h, ox + 2, oy + 1, 8, 3)
      px(ctx, h, ox + 9, oy + 3, 2, 6)
      break
    case 'curly':
      px(ctx, h, ox + 2, oy + 0, 8, 4)
      px(ctx, h, ox + 1, oy + 2, 1, 4)
      px(ctx, h, ox + 10, oy + 2, 1, 4)
      px(ctx, darker(h, 0.2), ox + 4, oy + 1, 1, 1)
      px(ctx, darker(h, 0.2), ox + 7, oy + 2, 1, 1)
      break
    default:
      px(ctx, h, ox + 2, oy + 1, 8, 3)
      px(ctx, h, ox + 2, oy + 4, 1, 2)
      px(ctx, h, ox + 9, oy + 4, 1, 2)
  }
}

/** Lying on the couch, head on the left. */
function drawSleeper(ctx: Ctx, look: Look, x: number, y: number, frame: number): void {
  const ox = Math.round(x) - 10
  const oy = Math.round(y) - 9
  px(ctx, '#34405a', ox + 12, oy + 3, 7, 3)
  px(ctx, '#1b1b22', ox + 19, oy + 3, 1, 3)
  px(ctx, look.shirt, ox + 5, oy + 2 + (frame % 2), 8, 4) // breathing
  px(ctx, look.skin, ox + 0, oy + 1, 5, 5)
  px(ctx, look.hair, ox + 0, oy + 0, 5, 2)
  px(ctx, look.hair, ox + 0, oy + 2, 1, 3)
  px(ctx, '#1b1b22', ox + 2, oy + 3, 2, 0.34) // closed eyes
}

// ── Furniture ────────────────────────────────────────────────────────────────

export function drawFloor(ctx: Ctx, w: number, h: number, top: number): void {
  for (let ty = top; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const plank = (tx + (ty % 2) * 2) % 4
      px(ctx, plank === 0 ? '#bf8f5a' : '#c99a62', tx * T, ty * T, T, T)
      px(ctx, '#ad7d4b', tx * T, ty * T + T - 1, T, 1)
      if (plank === 0) px(ctx, '#ad7d4b', tx * T, ty * T, 1, T)
    }
  }
}

export function drawWall(ctx: Ctx, w: number): void {
  px(ctx, '#53627f', 0, 0, w * T, 2 * T)
  px(ctx, '#46546f', 0, 2 * T - 4, w * T, 4)
  px(ctx, '#3a465c', 0, 2 * T - 1, w * T, 1)
}

export function drawWindow(ctx: Ctx, tx: number, frame: number): void {
  const x = tx * T + 2
  px(ctx, '#e8ecf3', x, 4, 2 * T - 4, 20)
  px(ctx, '#8fd0ff', x + 2, 6, 2 * T - 8, 16)
  px(ctx, '#ffffff', x + 5 + ((frame >> 3) % 10), 9, 6, 2) // a cloud drifting by
  px(ctx, '#e8ecf3', x + T - 3, 6, 2, 16)
}

export function drawDesk(ctx: Ctx, tx: number, ty: number, w = 2): void {
  const x = tx * T
  const y = ty * T
  px(ctx, '#8b5a2b', x, y + 2, w * T, 7)
  px(ctx, '#a06a36', x, y + 2, w * T, 2)
  px(ctx, '#6e4421', x + 1, y + 9, w * T - 2, 6)
  px(ctx, '#5a371a', x + 2, y + 15, 2, 1)
  px(ctx, '#5a371a', x + w * T - 4, y + 15, 2, 1)
}

/** A monitor seen from behind, and a keyboard: the person behind the desk stays visible. */
export function drawComputer(ctx: Ctx, tx: number, ty: number, on: boolean, frame: number): void {
  const x = tx * T
  const y = ty * T
  px(ctx, '#2b2f3a', x + 2, y - 6, 9, 7)
  px(ctx, on ? (frame % 2 ? '#6fd3ff' : '#58c2f2') : '#3b4252', x + 3, y - 5, 7, 5)
  px(ctx, '#2b2f3a', x + 6, y + 1, 1, 2)
  px(ctx, '#d9dde3', x + 13, y + 3, 9, 2)
}

export function drawMug(ctx: Ctx, x: number, y: number): void {
  px(ctx, '#f4f4f4', x, y, 3, 3)
  px(ctx, '#6f4a2a', x, y, 3, 1)
}

export function drawBookshelf(ctx: Ctx, tx: number): void {
  const x = tx * T
  px(ctx, '#7a4b26', x, 8, 2 * T, 40)
  const books = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400']
  for (let shelf = 0; shelf < 3; shelf++) {
    px(ctx, '#5c3518', x + 1, 8 + shelf * 13 + 12, 2 * T - 2, 1)
    for (let b = 0; b < 7; b++) px(ctx, books[(b + shelf * 3) % books.length]!, x + 2 + b * 4, 8 + shelf * 13 + 3 + (b % 3), 3, 9 - (b % 3))
  }
}

export function drawServerRack(ctx: Ctx, tx: number, frame: number): void {
  const x = tx * T
  px(ctx, '#2d3340', x + 1, 6, T - 2, 42)
  for (let u = 0; u < 6; u++) {
    px(ctx, '#3c4456', x + 2, 8 + u * 6, T - 4, 4)
    px(ctx, (frame + u) % 3 === 0 ? '#2ecc71' : '#1b5e3a', x + 3, 9 + u * 6, 1, 1)
    px(ctx, (frame + u * 2) % 4 === 0 ? '#5dade2' : '#1f4e6e', x + 5, 9 + u * 6, 1, 1)
  }
}

export function drawLab(ctx: Ctx, tx: number, frame: number): void {
  const x = tx * T
  px(ctx, '#d9dde3', x, 30, 2 * T, 5)
  px(ctx, '#aab1bb', x + 1, 35, 2 * T - 2, 13)
  px(ctx, '#7fd17f', x + 4, 24, 4, 6)
  px(ctx, '#ffffff', x + 5, 22, 2, 2)
  px(ctx, '#f39c12', x + 12, 25, 5, 5)
  px(ctx, '#ffffff', x + 13, 23, 3, 2)
  px(ctx, frame % 2 ? '#e74c3c' : '#c0392b', x + 22, 26, 4, 4)
  if (frame % 3 === 0) px(ctx, '#ffffff', x + 6, 19, 1, 1) // a bubble rising
}

export function drawWhiteboard(ctx: Ctx, tx: number): void {
  const x = tx * T
  px(ctx, '#c9ced6', x + 1, 3, 2 * T - 2, 22)
  px(ctx, '#f7f9fb', x + 2, 4, 2 * T - 4, 19)
  px(ctx, '#2e86de', x + 5, 8, 12, 1)
  px(ctx, '#e74c3c', x + 5, 12, 18, 1)
  px(ctx, '#27ae60', x + 5, 16, 9, 1)
}

export function drawKitchen(ctx: Ctx, tx: number, frame: number): void {
  const x = tx * T
  px(ctx, '#b9b2a6', x, 34, 4 * T, 14)
  px(ctx, '#e6e1d8', x, 30, 4 * T, 5)
  px(ctx, '#9b9488', x + T, 36, 1, 12)
  px(ctx, '#9b9488', x + 3 * T, 36, 1, 12)
  // The coffee machine, with steam.
  px(ctx, '#3a3a3a', x + 2 * T + 4, 16, 12, 14)
  px(ctx, frame % 2 ? '#e74c3c' : '#8e2b22', x + 2 * T + 6, 19, 2, 2)
  px(ctx, '#f4f4f4', x + 2 * T + 8, 25, 4, 4)
  if (frame % 2) px(ctx, '#ffffff', x + 2 * T + 9, 21, 1, 2)
  else px(ctx, '#ffffff', x + 2 * T + 10, 20, 1, 2)
  drawMug(ctx, x + 6, 27)
  drawMug(ctx, x + 12, 27)
}

export function drawCouch(ctx: Ctx, tx: number, ty: number, w = 4): void {
  const x = tx * T
  const y = ty * T
  px(ctx, '#e3c48a', x - 6, y + 8, w * T + 12, 22) // the rug
  px(ctx, '#a94442', x, y, w * T, 8)
  px(ctx, '#c75b5b', x, y + 8, w * T, 8)
  px(ctx, '#d97070', x + 2, y + 8, w * T - 4, 3)
  px(ctx, '#8f3a38', x, y + 2, 3, 15)
  px(ctx, '#8f3a38', x + w * T - 3, y + 2, 3, 15)
}

export function drawPlant(ctx: Ctx, x: number, y: number): void {
  px(ctx, '#b5651d', x + 3, y + 10, 8, 7)
  px(ctx, '#3fa34d', x + 2, y + 2, 10, 8)
  px(ctx, '#2f8a3c', x + 5, y - 2, 4, 6)
  px(ctx, '#56c063', x + 3, y + 3, 3, 2)
}

export function drawMeetingTable(ctx: Ctx, tx: number, ty: number, w = 4): void {
  const x = tx * T
  const y = ty * T
  px(ctx, '#9a6b3f', x + 3, y + 2, w * T - 6, 10)
  px(ctx, '#b07d4a', x + 3, y + 2, w * T - 6, 3)
  px(ctx, '#7a5230', x + 5, y + 12, w * T - 10, 2)
}

/** The manager's glass office: carpet, glass walls with a door. */
export function drawManagerRoom(ctx: Ctx, tx: number, ty: number, w: number, h: number): void {
  const x = tx * T
  const y = ty * T
  px(ctx, '#6d5a8f', x, y, w * T, h * T)
  px(ctx, '#7b68a0', x + 2, y + 2, w * T - 4, h * T - 4)
  ctx.globalAlpha = 0.45
  px(ctx, '#cfeaff', x + w * T - 2, y, 2, h * T)
  px(ctx, '#cfeaff', x, y + h * T - 2, w * T - 3 * T, 2)
  ctx.globalAlpha = 1
  px(ctx, '#8fb8d8', x + w * T - 2, y, 2, 2)
  px(ctx, '#8fb8d8', x + w * T - 2, y + h * T - 2, 2, 2)
  px(ctx, '#8fb8d8', x + w * T - 3 * T, y + h * T - 2, 2, 2)
}
