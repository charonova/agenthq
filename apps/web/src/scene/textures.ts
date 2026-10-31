import { Texture } from 'pixi.js'
import {
  drawBookshelf,
  drawComputer,
  drawCouch,
  drawDesk,
  drawFloor,
  drawKitchen,
  drawLab,
  drawManagerRoom,
  drawMeetingTable,
  drawPlant,
  drawServerRack,
  drawWall,
  drawWhiteboard,
  drawWindow,
} from './art/furniture'
import type { Ctx } from './art/paint'
import { drawPerson, type Look, type Pose } from './art/people'
import { MANAGER_ROOM, T, W, lounge, props } from './layout'

/**
 * Every picture the scene uses, drawn once in code and kept as a texture. People are
 * 24×26 art pixels with their feet at (12, 24); the scene scales everything up.
 */

const cache = new Map<string, Texture>()

function paint(key: string, width: number, height: number, draw: (ctx: Ctx) => void): Texture {
  const cached = cache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = 'nearest'
  cache.set(key, texture)
  return texture
}

/** How many frames each animation has: they loop. */
export const FRAMES = { person: 14, props: 12 } as const

export const PERSON = { width: 24, height: 26, feetX: 12, feetY: 24 } as const

export function lookKey(look: Look): string {
  return `${look.skin}${look.hair}${look.style}${look.figure}${look.shirt}${look.outfit}`
}

export function personTexture(look: Look, pose: Pose, frame: number): Texture {
  const f = frame % FRAMES.person
  return paint(`person:${lookKey(look)}:${pose}:${f}`, PERSON.width, PERSON.height, (ctx) =>
    drawPerson(ctx, look, PERSON.feetX, PERSON.feetY, pose, f),
  )
}

/** The room itself: floor, walls and everything that never moves, for an office this many tiles tall. */
export function roomTexture(height: number): Texture {
  return paint(`room:${height}`, W * T, height * T, (ctx) => {
    drawFloor(ctx, W, height, 2)
    drawWall(ctx, W)
    drawWhiteboard(ctx, props.whiteboard)
    drawManagerRoom(ctx, MANAGER_ROOM.tx, MANAGER_ROOM.ty, MANAGER_ROOM.w, MANAGER_ROOM.h)
    drawBookshelf(ctx, props.bookshelf)
    for (const couch of lounge.couches) drawCouch(ctx, couch.tx, couch.ty)
    const plant = lounge.plant(height)
    drawPlant(ctx, plant.tx * T, plant.ty * T)
    drawPlant(ctx, 21 * T, 2 * T + 2)
    // The door.
    ctx.fillStyle = '#7a4b26'
    ctx.fillRect(7 * T, height * T - 3, 2 * T, 3)
  })
}

/** The parts of the room that move: drawn on their own small textures, one per frame. */
export const animatedProps = {
  window: (frame: number) =>
    paint(`window:${frame % FRAMES.props}`, 2 * T, 2 * T, (ctx) => drawWindow(ctx, 0, frame % FRAMES.props)),
  rack: (frame: number) => paint(`rack:${frame % FRAMES.props}`, T, 3 * T, (ctx) => drawServerRack(ctx, 0, frame % FRAMES.props)),
  lab: (frame: number) => paint(`lab:${frame % FRAMES.props}`, 2 * T, 3 * T, (ctx) => drawLab(ctx, 0, frame % FRAMES.props)),
  kitchen: (frame: number) =>
    paint(`kitchen:${frame % FRAMES.props}`, 4 * T, 3 * T, (ctx) => drawKitchen(ctx, 0, frame % FRAMES.props)),
}

/** A desk, with its computer on or off, or a plain side table for interns. */
export function deskTexture(kind: 'computer-on' | 'computer-off' | 'table', frame: number): Texture {
  const f = kind === 'computer-on' ? frame % 2 : 0
  // Drawn with room above for the monitor: the desk's tile starts 8 pixels down.
  return paint(`desk:${kind}:${f}`, 2 * T, T + 8, (ctx) => {
    ctx.translate(0, 8)
    drawDesk(ctx, 0, 0, 2)
    if (kind !== 'table') drawComputer(ctx, 0, 0, kind === 'computer-on', f)
  })
}

export function meetingTableTexture(): Texture {
  return paint('meeting-table', props.meetingTable.w * T, T, (ctx) => drawMeetingTable(ctx, 0, 0, props.meetingTable.w))
}
