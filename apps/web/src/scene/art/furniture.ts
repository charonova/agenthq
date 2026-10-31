import { T } from '../layout'
import { px, type Ctx } from './paint'

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

/** The way in, at the bottom wall: shut, or open with its panel swung into the room. `x` is its left edge. */
export function drawDoor(ctx: Ctx, x: number, bottom: number, open: boolean): void {
  if (!open) {
    px(ctx, '#7a4b26', x, bottom - 3, 2 * T, 3)
    px(ctx, '#5e3a1d', x + T - 1, bottom - 3, 1, 3)
    return
  }
  px(ctx, '#2b2119', x, bottom - 3, 2 * T, 3) // the doorway
  px(ctx, '#7a4b26', x, bottom - 16, 3, 13) // the panel, hinged on the left
  px(ctx, '#5e3a1d', x + 2, bottom - 16, 1, 13)
  px(ctx, '#e0b54a', x + 1, bottom - 9, 1, 1) // its handle
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
    for (let b = 0; b < 7; b++)
      px(ctx, books[(b + shelf * 3) % books.length]!, x + 2 + b * 4, 8 + shelf * 13 + 3 + (b % 3), 3, 9 - (b % 3))
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
