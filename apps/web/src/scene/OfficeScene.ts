import type { Agent, Office } from '@agenthq/core'
import { Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js'
import { lookKeyOf } from '../state/view'
import { lookFor, type Look, type LookChoice, type Pose } from './art/people'
import { MANAGER_DESK, T, W, blockedTiles, deskOf, door, props, roomHeight, seatAt, type Point } from './layout'
import { findPath } from './path'
import { planOffice, type Spot } from './plan'
import { PERSON, animatedProps, deskTexture, meetingTableTexture, personTexture, roomTexture } from './textures'

const WALK_SPEED = 42 // art pixels per second

/** Text is drawn at a high resolution, so it stays sharp when the camera zooms in. */
const TEXT_RESOLUTION = 8

interface Person {
  id: string
  look: Look
  sprite: Sprite
  bubble: Bubble
  x: number
  y: number
  spot: Spot
  path: Point[]
  leaving: boolean
}

/** A speech bubble: a rounded box with a tail, and its text. */
class Bubble extends Container {
  private box = new Graphics()
  private caption: Text
  private current = ''

  constructor() {
    super()
    this.caption = new Text({
      text: '',
      style: { fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif', fontSize: 5, fill: '#1d2230' },
      resolution: TEXT_RESOLUTION,
    })
    this.caption.anchor.set(0.5, 1)
    this.addChild(this.box, this.caption)
  }

  set(text: string | null) {
    this.visible = text !== null
    if (text === null || text === this.current) return
    this.current = text
    this.caption.text = text
    const width = Math.max(this.caption.width + 5, 9)
    const height = 8
    this.box
      .clear()
      .roundRect(-width / 2, -height - 2, width, height, 2.5)
      .fill({ color: 0xffffff, alpha: 0.96 })
      .stroke({ color: 0x1e1e28, alpha: 0.3, width: 0.4 })
      .poly([-1.5, -2, 0, 0, 1.5, -2])
      .fill({ color: 0xffffff, alpha: 0.96 })
    this.caption.position.set(0, -3.2)
  }
}

const tagStyle: TextStyleOptions = {
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 4,
  fontWeight: '600',
  fill: '#e8ecf3',
}

/** One office: its room, desks and people, and where everyone walks. */
export class OfficeScene extends Container {
  readonly sessionId: string
  office: Office
  /** Its height, in tiles. */
  private tiles: number
  private room = new Sprite()
  private propSprites = {
    window: new Sprite(),
    rack: new Sprite(),
    lab: new Sprite(),
    kitchen: new Sprite(),
  }
  /** Desks and people, sorted by depth so a desk hides the legs of whoever sits behind it. */
  private depth = new Container({ sortableChildren: true })
  private desks: Sprite[] = []
  private night = new Graphics()
  private labels = new Container()
  private bubbles = new Container()
  private selection = new Graphics()
  private people = new Map<string, Person>()
  private grid: boolean[][] = []
  private frame = 0
  private darkness = -1
  selectedId: string | null = null
  /** Bubbles show only their emoji when the office is small on screen. */
  compact = false
  /** Reduced motion: people step straight to where they go. */
  reduced = false
  /** The looks you chose, by whose they are. */
  private looks: Record<string, LookChoice> = {}

  constructor(office: Office) {
    super()
    this.sessionId = office.sessionId
    this.office = office
    this.tiles = roomHeight(office.staff.length)
    const p = this.propSprites
    p.window.position.set(props.window * T, 0)
    p.rack.position.set(props.rack * T, 0)
    p.lab.position.set(props.lab * T, 0)
    p.kitchen.position.set(props.kitchen * T, 0)
    const table = new Sprite(meetingTableTexture())
    table.position.set(props.meetingTable.tx * T, props.meetingTable.ty * T)
    table.zIndex = props.meetingTable.ty * T + 12
    this.depth.addChild(table)
    this.addChild(
      this.room,
      p.window,
      p.rack,
      p.lab,
      p.kitchen,
      this.depth,
      this.night,
      this.selection,
      this.labels,
      this.bubbles,
    )
    this.update(office, true)
  }

  get size() {
    return { width: W * T, height: this.tiles * T }
  }

  /** New data for this office: who's here, and where each of them should go. */
  update(office: Office, firstLook = false) {
    this.office = office
    const height = roomHeight(office.staff.length)
    if (height !== this.tiles || firstLook) {
      this.tiles = height
      this.room.texture = roomTexture(height)
    }
    this.grid = blockedTiles(office)
    this.layoutDesks(office)
    this.layoutLabels(office)

    const plans = planOffice(office)
    const agents = new Map([office.manager, ...office.staff, ...office.interns].map((agent) => [agent.id, agent]))
    for (const [id, plan] of plans) {
      const agent = agents.get(id)!
      const person = this.people.get(id) ?? this.addPerson(agent, firstLook ? plan.spot : door(this.tiles))
      person.leaving = false
      person.bubble.set(this.compact ? firstEmoji(plan.bubble) : plan.bubble)
      this.walkTo(person, plan.spot)
    }
    // Whoever isn't in the plan anymore says bye and walks out of the door.
    for (const person of this.people.values()) {
      if (plans.has(person.id) || person.leaving) continue
      person.leaving = true
      person.bubble.set('👋')
      this.walkTo(person, { ...door(this.tiles), pose: 'walk', lift: 0 })
    }
    this.tick(0, this.frame)
  }

  private lookOf(agent: Agent): Look {
    return lookFor(agent.name + agent.id, agent.color, agent.role, this.looks[lookKeyOf(agent, this.office)])
  }

  /** New choices of looks: everyone here who has one changes clothes at once. */
  setLooks(looks: Record<string, LookChoice>) {
    this.looks = looks
    const agents = [this.office.manager, ...this.office.staff, ...this.office.interns]
    for (const agent of agents) {
      const person = this.people.get(agent.id)
      if (person) person.look = this.lookOf(agent)
    }
  }

  private addPerson(agent: Agent, at: Point): Person {
    const look = this.lookOf(agent)
    const sprite = new Sprite(personTexture(look, 'stand', 0))
    sprite.anchor.set(PERSON.feetX / PERSON.width, PERSON.feetY / PERSON.height)
    const bubble = new Bubble()
    const person: Person = {
      id: agent.id,
      look,
      sprite,
      bubble,
      x: at.x,
      y: at.y,
      spot: { ...at, pose: 'stand', lift: 0 },
      path: [],
      leaving: false,
    }
    this.depth.addChild(sprite)
    this.bubbles.addChild(bubble)
    this.people.set(agent.id, person)
    return person
  }

  private walkTo(person: Person, spot: Spot) {
    const moved = spot.x !== person.spot.x || spot.y !== person.spot.y
    person.spot = spot
    if (!moved && person.path.length === 0) return
    if (moved) person.path = findPath(this.grid, { x: person.x, y: person.y }, spot)
  }

  private layoutDesks(office: Office) {
    for (const desk of this.desks) desk.destroy()
    this.desks = []
    const occupiedSeats = new Set(
      [...this.people.values()]
        .filter((p) => p.path.length === 0 && p.spot.pose === 'type')
        .map((p) => `${p.spot.x},${p.spot.y}`),
    )
    const hasInterns = (id: string) => office.interns.some((intern) => intern.parentId === id && intern.state !== 'gone')
    const add = (tx: number, ty: number, kind: 'computer' | 'table') => {
      const seat = seatAt(tx, ty)
      const on = occupiedSeats.has(`${seat.x},${seat.y}`)
      const sprite = new Sprite(deskTexture(kind === 'table' ? 'table' : on ? 'computer-on' : 'computer-off', this.frame))
      sprite.position.set(tx * T, ty * T - 8)
      sprite.zIndex = ty * T + 12
      sprite.label = kind === 'computer' ? `desk:${on ? 'on' : 'off'}` : 'table'
      this.depth.addChild(sprite)
      this.desks.push(sprite)
    }
    add(MANAGER_DESK.tx, MANAGER_DESK.ty, 'computer')
    if (hasInterns(office.sessionId)) add(MANAGER_DESK.tx + 2, MANAGER_DESK.ty, 'table')
    office.staff.forEach((agent, i) => {
      const { tx, ty } = deskOf(i)
      add(tx, ty, 'computer')
      if (hasInterns(agent.id)) add(tx + 2, ty, 'table')
    })
  }

  private layoutLabels(office: Office) {
    this.labels.removeChildren().forEach((child) => child.destroy())
    const tag = (text: string, x: number, y: number, color: string) => {
      const label = new Text({ text, style: { ...tagStyle, fill: color }, resolution: TEXT_RESOLUTION })
      label.anchor.set(0.5, 0)
      const back = new Graphics()
        .roundRect(-label.width / 2 - 1.5, -0.5, label.width + 3, label.height + 1, 1.2)
        .fill({ color: 0x14161e, alpha: 0.78 })
      const group = new Container()
      group.addChild(back, label)
      group.position.set(x, y)
      this.labels.addChild(group)
    }
    tag(office.kind === 'codex' ? 'Codex' : 'Manager', MANAGER_DESK.tx * T + 20, MANAGER_DESK.ty * T + 17, '#ffd479')
    office.staff.forEach((agent, i) => {
      const { tx, ty } = deskOf(i)
      tag(agent.name, tx * T + 16, ty * T + 17, '#e8ecf3')
    })
  }

  /** Moves everyone along their path and advances the animations. `frame` ticks about 3 times a second. */
  tick(dt: number, frame: number) {
    const frameChanged = frame !== this.frame
    this.frame = frame
    const p = this.propSprites
    p.window.texture = animatedProps.window(frame >> 2)
    p.rack.texture = animatedProps.rack(frame)
    p.lab.texture = animatedProps.lab(frame)
    p.kitchen.texture = animatedProps.kitchen(frame)

    for (const person of [...this.people.values()]) {
      if (this.reduced && person.path.length > 0) {
        const end = person.path[person.path.length - 1]!
        person.x = end.x
        person.y = end.y
        person.path = []
      }
      let budget = WALK_SPEED * dt
      while (budget > 0 && person.path.length > 0) {
        const next = person.path[0]!
        const dx = next.x - person.x
        const dy = next.y - person.y
        const distance = Math.hypot(dx, dy)
        if (distance <= budget) {
          person.x = next.x
          person.y = next.y
          person.path.shift()
          budget -= distance
        } else {
          person.x += (dx / distance) * budget
          person.y += (dy / distance) * budget
          budget = 0
        }
      }
      if (person.leaving && person.path.length === 0) {
        person.sprite.destroy()
        person.bubble.destroy()
        this.people.delete(person.id)
        continue
      }
      const walking = person.path.length > 0
      const pose: Pose = walking ? 'walk' : person.spot.pose
      // Everyone gets their own rhythm, so a room doesn't blink in unison.
      person.sprite.texture = personTexture(person.look, pose, frame + (person.id.charCodeAt(0) % 5))
      person.sprite.position.set(Math.round(person.x), Math.round(person.y))
      person.sprite.zIndex = person.y + (pose === 'sleep' ? 20 : 0)
      const lift = walking ? 0 : person.spot.lift
      person.bubble.position.set(Math.round(person.x), Math.round(person.y - (pose === 'sleep' ? 8 : 21) - lift))
    }
    // Reduced motion keeps one frame: screens follow who sits down instead.
    if (frameChanged || this.reduced) this.refreshScreens()
    this.drawSelection()
  }

  /** Monitors light up at desks where someone is typing. */
  private refreshScreens() {
    const typing = new Set(
      [...this.people.values()]
        .filter((p) => p.path.length === 0 && p.spot.pose === 'type')
        .map((p) => `${p.spot.x},${p.spot.y}`),
    )
    for (const desk of this.desks) {
      if (desk.label === 'table') continue
      const tx = Math.round(desk.x / T)
      const ty = Math.round((desk.y + 8) / T)
      const seat = seatAt(tx, ty)
      desk.texture = deskTexture(typing.has(`${seat.x},${seat.y}`) ? 'computer-on' : 'computer-off', this.frame)
    }
  }

  private drawSelection() {
    this.selection.clear()
    const person = this.selectedId ? this.people.get(this.selectedId) : undefined
    if (!person) return
    this.selection.ellipse(Math.round(person.x), Math.round(person.y), 8, 2.6).stroke({ color: 0xffd479, width: 1 })
  }

  /** Day and night (the clock's, or always one): a little darker in the evening, dim at night with screens aglow. */
  setDaylight(darkness: number) {
    if (darkness === this.darkness) return
    this.darkness = darkness
    this.night.clear()
    if (darkness <= 0) return
    this.night.rect(0, 0, W * T, this.tiles * T).fill({ color: 0x0b1030, alpha: darkness })
  }

  setCompact(compact: boolean) {
    if (compact === this.compact) return
    this.compact = compact
    this.labels.visible = !compact
    const plans = planOffice(this.office)
    for (const [id, plan] of plans) this.people.get(id)?.bubble.set(compact ? firstEmoji(plan.bubble) : plan.bubble)
  }

  /** The agent under a point in this office's own coordinates. */
  agentAt(x: number, y: number): string | null {
    let found: { id: string; depth: number } | null = null
    for (const person of this.people.values()) {
      if (person.leaving) continue
      const inside = x >= person.x - 7 && x <= person.x + 7 && y >= person.y - 21 && y <= person.y + 2
      if (inside && (!found || person.y > found.depth)) found = { id: person.id, depth: person.y }
    }
    return found?.id ?? null
  }
}

function firstEmoji(text: string | null): string | null {
  if (!text) return null
  return [...new Intl.Segmenter().segment(text)][0]?.segment ?? null
}
