import { darker, hash, px, type Ctx } from './paint'

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

export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'raise' | 'drink' | 'sleep' | 'read'

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
