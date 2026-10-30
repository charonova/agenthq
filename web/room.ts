import type { Activity, Agent, Office } from '../src/core/types.js'
import {
  S,
  T,
  drawBookshelf,
  drawComputer,
  drawCouch,
  drawDesk,
  drawFloor,
  drawKitchen,
  drawLab,
  drawManagerRoom,
  drawMeetingTable,
  drawPerson,
  drawPlant,
  drawServerRack,
  drawWall,
  drawWhiteboard,
  drawWindow,
  lookFor,
  px,
  type Ctx,
  type Look,
  type Pose,
} from './art.js'

// ── The floor plan, in tiles ─────────────────────────────────────────────────
//
//  wall ─────────────── whiteboard ─ window ─────────── (wall)
//  [manager's glass office]  shelf rack lab            kitchen ☕
//  [  desk  + intern stools ]   meeting table          couch 🛋
//  desk desk desk desk desk                            plant
//  desk desk …  (5 per row, interns on stools beside their boss)

const W = 28
const PER_ROW = 5
const DESKS_TOP = 9
const MANAGER_DESK = { tx: 2, ty: 4 }

interface Spot {
  x: number
  y: number
  pose: Pose
  /** Bubbles of people sharing a spot are staggered, so they don't cover each other. */
  lift?: number
}

/** Where people stand for each shared activity (several can share: they spread out). */
const shared: Record<string, { x: number; y: number; pose: Pose; spread: number }> = {
  read: { x: 9 * T + 16, y: 62, pose: 'read', spread: 12 },
  run: { x: 12 * T + 8, y: 62, pose: 'stand', spread: 12 },
  test: { x: 14 * T + 16, y: 62, pose: 'stand', spread: 12 },
  plan: { x: 17 * T + 16, y: 62, pose: 'stand', spread: 12 },
  web: { x: 20 * T + 16, y: 62, pose: 'stand', spread: 12 },
  coffee: { x: 23 * T + 10, y: 62, pose: 'drink', spread: 14 },
  message: { x: 10 * T + 12, y: 5 * T + 6, pose: 'stand', spread: 14 },
  couch: { x: 25 * T, y: 7 * T + 13, pose: 'sleep', spread: 20 },
  couch2: { x: 25 * T, y: 11 * T + 13, pose: 'sleep', spread: 20 },
  watch: { x: 6 * T + 8, y: 6 * T + 12, pose: 'stand', spread: 10 },
}

const icon: Record<Activity, string> = {
  thinking: '💭',
  edit: '✏️',
  read: '📖',
  run: '⚡',
  test: '🧪',
  web: '🌐',
  delegate: '📞',
  message: '💬',
  plan: '📝',
  tool: '🔧',
}

const deskOf = (index: number) => ({ tx: 1 + (index % PER_ROW) * 4, ty: DESKS_TOP + Math.floor(index / PER_ROW) * 4 })
const seatAt = (tx: number, ty: number) => ({ x: tx * T + 20, y: ty * T + 6 })

interface Person {
  id: string
  look: Look
  x: number
  y: number
  target: Spot
  bubble: string | null
  leaving: boolean
  agent: Agent
}

export type Detail = 'full' | 'mini'

/** One office: its furniture, its people, and where each of them should be right now. */
export class Room {
  readonly canvas: HTMLCanvasElement
  private ctx: Ctx
  private people = new Map<string, Person>()
  private office: Office | null = null
  private rows = 1
  private height = 13
  private hits: { id: string; x: number; y: number; w: number; h: number }[] = []
  selected: string | null = null

  constructor(readonly detail: Detail) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = `room room-${detail}`
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
  }

  private resize() {
    const width = W * T * S
    const height = this.height * T * S
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private get door(): Spot {
    return { x: 7 * T + 8, y: this.height * T - 2, pose: 'walk' }
  }

  update(office: Office) {
    // On the first look everyone is already in place; later arrivals walk in through the door.
    const firstLook = this.office === null
    this.office = office
    this.rows = Math.max(1, Math.ceil(office.staff.length / PER_ROW))
    this.height = Math.max(13, DESKS_TOP + this.rows * 4 + 1)
    this.resize()

    const everyone = [office.manager, ...office.staff, ...office.interns].filter((agent) => agent.state !== 'gone')
    const seen = new Set<string>()
    const crowd = new Map<string, number>()
    for (const agent of everyone) {
      seen.add(agent.id)
      const target = this.spotFor(agent, office, crowd)
      const existing = this.people.get(agent.id)
      if (existing) {
        existing.target = target
        existing.agent = agent
        existing.bubble = bubbleFor(agent)
        existing.leaving = false
      } else {
        const door = firstLook ? target : this.door
        this.people.set(agent.id, {
          id: agent.id,
          look: lookFor(agent.name + agent.id, agent.color, agent.role),
          x: door.x,
          y: door.y,
          target,
          bubble: bubbleFor(agent),
          leaving: false,
          agent,
        })
      }
    }
    // Whoever isn't here anymore heads home.
    for (const person of this.people.values()) {
      if (!seen.has(person.id) && !person.leaving) {
        person.leaving = true
        person.bubble = '👋'
        person.target = this.door
      }
    }
    // Draw right away, so a room never shows empty while it waits for the next frame.
    this.render(performance.now())
  }

  /** Where an agent goes for what it's doing. */
  private spotFor(agent: Agent, office: Office, crowd: Map<string, number>): Spot {
    const home = this.homeOf(agent, office)
    const sharedSpot = (name: string): Spot => {
      const base = shared[name]!
      const n = crowd.get(name) ?? 0
      crowd.set(name, n + 1)
      const side = n % 2 === 0 ? 1 : -1
      return { x: base.x + side * Math.ceil(n / 2) * base.spread, y: base.y + (base.pose === 'sleep' ? 0 : (n % 3) * 2), pose: base.pose, lift: (n % 2) * 9 }
    }
    if (agent.state === 'idle') {
      if (agent.rest === 'coffee') return sharedSpot('coffee')
      // Two couches of three; whoever's left naps standing by the coffee machine.
      if (agent.rest === 'couch') {
        if ((crowd.get('couch') ?? 0) < 3) return sharedSpot('couch')
        return (crowd.get('couch2') ?? 0) < 3 ? sharedSpot('couch2') : sharedSpot('coffee')
      }
      if (agent.rest === 'watching') return sharedSpot('watch')
      return { ...home, pose: 'sit' }
    }
    if (agent.state === 'waiting') return { ...home, pose: 'raise' }
    if (agent.state === 'done') return { ...home, pose: 'sit' }
    switch (agent.activity) {
      case 'read':
      case 'run':
      case 'test':
      case 'plan':
      case 'web':
      case 'message':
        return sharedSpot(agent.activity)
      default:
        return { ...home, pose: 'type' }
    }
  }

  /** The agent's own chair: the manager's desk, a staff desk, or a stool beside the boss. */
  private homeOf(agent: Agent, office: Office): { x: number; y: number } {
    if (agent.role === 'manager') return seatAt(MANAGER_DESK.tx, MANAGER_DESK.ty)
    if (agent.role === 'staff') {
      const { tx, ty } = deskOf(office.staff.findIndex((a) => a.id === agent.id))
      return seatAt(tx, ty)
    }
    const siblings = office.interns.filter((i) => i.parentId === agent.parentId)
    const n = siblings.findIndex((i) => i.id === agent.id)
    const boss = office.staff.findIndex((a) => a.id === agent.parentId)
    const desk = boss >= 0 ? deskOf(boss) : MANAGER_DESK
    // Two stools beside each desk; more interns crowd the meeting table.
    if (n < 2) return { x: (desk.tx + 2 + n) * T + 8, y: desk.ty * T + 6 }
    return { x: shared.message!.x + (n - 1) * 12, y: shared.message!.y }
  }

  /** Moves everyone a little towards where they're going. */
  step(dt: number) {
    const speed = 42 // art pixels per second
    for (const person of [...this.people.values()]) {
      const dx = person.target.x - person.x
      const dy = person.target.y - person.y
      const distance = Math.hypot(dx, dy)
      if (distance < 0.5) {
        person.x = person.target.x
        person.y = person.target.y
        if (person.leaving) this.people.delete(person.id)
        continue
      }
      const move = Math.min(distance, speed * dt)
      person.x += (dx / distance) * move
      person.y += (dy / distance) * move
    }
  }

  render(time: number) {
    const ctx = this.ctx
    const frame = Math.floor(time / 300)
    const office = this.office
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    drawFloor(ctx, W, this.height, 2)
    drawWall(ctx, W)
    drawWhiteboard(ctx, 17)
    drawWindow(ctx, 20, frame)
    drawManagerRoom(ctx, 0, 2, 8, 5)
    drawBookshelf(ctx, 9)
    drawServerRack(ctx, 12, frame)
    drawLab(ctx, 14, frame)
    drawKitchen(ctx, 23, frame)
    drawCouch(ctx, 23, 7)
    drawCouch(ctx, 23, 11)
    drawPlant(ctx, 27 * T - 2, 14 * T)
    drawPlant(ctx, 21 * T, 2 * T + 2)
    // The door.
    px(ctx, '#7a4b26', 7 * T, this.height * T - 3, 2 * T, 3)

    // Desks and people, back to front, so a desk hides the legs of whoever sits behind it.
    type Item = { depth: number; draw: () => void }
    const items: Item[] = []
    const occupied = new Set<string>()
    for (const person of this.people.values()) {
      const atHome = Math.hypot(person.target.x - person.x, person.target.y - person.y) < 0.5
      if (atHome) occupied.add(`${person.target.x},${person.target.y}`)
    }
    const deskItem = (tx: number, ty: number, w: number, computer: boolean) => {
      const seat = seatAt(tx, ty)
      const on = occupied.has(`${seat.x},${seat.y}`)
      items.push({ depth: ty * T + 12, draw: () => {
        drawDesk(ctx, tx, ty, w)
        if (computer) drawComputer(ctx, tx, ty, on, frame)
      } })
    }
    // A side table appears for whoever has interns.
    const hasInterns = (id: string) => office?.interns.some((intern) => intern.parentId === id && intern.state !== 'gone') ?? false
    deskItem(MANAGER_DESK.tx, MANAGER_DESK.ty, 2, true)
    if (office && hasInterns(office.sessionId)) deskItem(MANAGER_DESK.tx + 2, MANAGER_DESK.ty, 2, false)
    items.push({ depth: 5 * T + 12, draw: () => drawMeetingTable(ctx, 10, 5, 4) })
    office?.staff.forEach((agent, i) => {
      const { tx, ty } = deskOf(i)
      deskItem(tx, ty, 2, true)
      if (hasInterns(agent.id)) deskItem(tx + 2, ty, 2, false)
    })
    this.hits = []
    for (const person of this.people.values()) {
      const moving = Math.hypot(person.target.x - person.x, person.target.y - person.y) >= 0.5
      const pose: Pose = moving ? 'walk' : person.target.pose
      items.push({
        depth: person.y + (pose === 'sleep' ? 20 : 0),
        draw: () => {
          drawPerson(ctx, person.look, person.x, person.y, pose, frame + (person.id.length % 3))
          this.hits.push({ id: person.id, x: person.x - 8, y: person.y - 22, w: 16, h: 24 })
        },
      })
    }
    items.sort((a, b) => a.depth - b.depth)
    for (const item of items) item.draw()

    // Labels on top: names under desks, bubbles over heads.
    if (office) this.drawLabels(office)
    for (const person of this.people.values()) {
      if (person.id === this.selected) this.drawSelection(person)
      if (person.bubble) this.drawBubble(person, frame)
    }
  }

  private drawLabels(office: Office) {
    if (this.detail === 'mini') return
    const ctx = this.ctx
    ctx.font = `600 ${11}px ui-sans-serif, system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    const tag = (text: string, x: number, y: number, color: string) => {
      const width = ctx.measureText(text).width + 10
      ctx.fillStyle = 'rgba(20, 22, 30, 0.78)'
      ctx.beginPath()
      ctx.roundRect(x * S - width / 2, y * S - 12, width, 16, 4)
      ctx.fill()
      ctx.fillStyle = color
      ctx.fillText(text, x * S, y * S)
    }
    tag('Manager', MANAGER_DESK.tx * T + 20, MANAGER_DESK.ty * T + 22, '#ffd479')
    office.staff.forEach((agent, i) => {
      const { tx, ty } = deskOf(i)
      tag(agent.name, tx * T + 20, ty * T + 22, '#e8ecf3')
    })
  }

  private drawBubble(person: Person, frame: number) {
    const ctx = this.ctx
    const mini = this.detail === 'mini'
    const text = mini ? [...(person.bubble ?? '')][0] ?? '' : person.bubble ?? ''
    ctx.font = mini ? '28px system-ui, sans-serif' : '12px ui-sans-serif, system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    const width = Math.max(ctx.measureText(text).width + (mini ? 8 : 14), mini ? 36 : 28)
    const height = mini ? 36 : 20
    const bob = person.target.pose === 'sleep' ? (frame % 2) * 2 : 0
    const x = person.x * S
    const y = (person.y - (person.target.pose === 'sleep' ? 12 : 24) - (person.target.lift ?? 0)) * S - bob
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.strokeStyle = 'rgba(30,30,40,0.35)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x - width / 2, y - height, width, height, 7)
    ctx.moveTo(x - 4, y)
    ctx.lineTo(x, y + 5)
    ctx.lineTo(x + 4, y)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#1d2230'
    ctx.fillText(text, x, y - (mini ? 9 : 6))
  }

  private drawSelection(person: Person) {
    const ctx = this.ctx
    ctx.strokeStyle = '#ffd479'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(person.x * S, person.y * S, 9 * S, 3 * S, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  /** Which agent is under a click, in canvas pixels. */
  agentAt(x: number, y: number): string | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i]!
      if (x >= hit.x * S && x <= (hit.x + hit.w) * S && y >= hit.y * S && y <= (hit.y + hit.h) * S) return hit.id
    }
    return null
  }
}

function short(text: string, max = 22): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** What the bubble over someone's head says. */
export function bubbleFor(agent: Agent): string | null {
  switch (agent.state) {
    case 'waiting':
      return '✋ needs you'
    case 'done':
      return '✅ done'
    case 'idle':
      return agent.rest === 'coffee' ? '☕' : agent.rest === 'couch' ? '💤' : agent.rest === 'watching' ? '👀' : null
    case 'working': {
      const activity = agent.activity ?? 'thinking'
      if (activity === 'thinking') return '💭'
      const target = agent.tool?.target
      return target ? `${icon[activity]} ${short(target)}` : icon[activity]
    }
    default:
      return null
  }
}
