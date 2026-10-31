import type { Office } from '@agenthq/core'
import { Application, Container, Graphics, Text, TextureSource } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import { speeds, themeDarkness, type Speed, type Theme } from '../state/view'
import type { LookChoice } from './art/people'
import { OfficeScene } from './OfficeScene'

TextureSource.defaultOptions.scaleMode = 'nearest'

const GAP = 56
const SIGN_HEIGHT = 18
/** Below this zoom, offices are small on screen: no name tags, emoji-only bubbles. */
const DETAIL_ZOOM = 1.6

/** How the building looks and moves, from the settings. */
export interface ViewOptions {
  theme: Theme
  speed: Speed
  /** People step straight to where they go, nothing blinks, and the camera cuts instead of gliding. */
  reduced: boolean
}

export interface WorldEvents {
  onFocus: (sessionId: string | null) => void
  onSelect: (agentId: string | null) => void
  /** A double-click on someone: go to their session. */
  onJump: (sessionId: string, agentId: string) => void
}

/** An office with its sign above the door: status light, project and title. */
class Floor extends Container {
  readonly scene: OfficeScene
  private sign = new Graphics()
  private light = new Graphics()
  private title: Text

  constructor(office: Office) {
    super()
    this.scene = new OfficeScene(office)
    this.scene.y = SIGN_HEIGHT
    this.title = new Text({
      text: '',
      style: {
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        fontSize: 9,
        fontWeight: '700',
        fill: '#eef0f6',
      },
      resolution: 6,
    })
    this.title.position.set(16, 3)
    this.addChild(this.sign, this.light, this.title, this.scene)
    this.update(office)
  }

  update(office: Office) {
    this.scene.update(office)
    const everyone = [office.manager, ...office.staff, ...office.interns]
    const waiting = everyone.some((agent) => agent.state === 'waiting')
    const working = everyone.some((agent) => agent.state === 'working')
    const project = office.kind === 'codex' ? `Codex · ${office.project}` : office.project
    const name = office.title ? `${project} · ${office.title}` : project
    this.title.text = office.ended ? `${name} · ended` : name
    // An ended session's office stays a while, dimmed, then closes.
    this.scene.alpha = office.ended ? 0.55 : 1
    const { width } = this.scene.size
    this.sign
      .clear()
      .roundRect(0, 0, width, SIGN_HEIGHT - 2, 4)
      .fill({ color: 0x1f212b })
    this.light
      .clear()
      .circle(8, 8, 3)
      .fill({ color: office.ended ? 0x3a3d4a : waiting ? 0xffd479 : working ? 0x4cd97b : 0x666c80 })
  }

  get size() {
    const { width, height } = this.scene.size
    return { width, height: height + SIGN_HEIGHT }
  }
}

/** The whole building, drawn with PixiJS: every live office on one map you can pan, zoom and click into. */
export class World {
  private app = new Application()
  private viewport!: Viewport
  private floors = new Map<string, Floor>()
  /** The office the camera is on (null: the whole building). */
  private focused: string | null = null
  /** The office asked for, which may not have arrived yet: the camera goes there once it does. */
  private wanted: string | null = null
  private ready: Promise<void>
  private disposed = false
  private elapsed = 0
  private compact = true
  private view: ViewOptions = { theme: 'clock', speed: 'normal', reduced: false }
  /** Something changed outside the offices' own ticks (offices came or went, a selection…): draw the next frame. */
  private dirty = true
  private looks: Record<string, LookChoice> = {}

  constructor(
    private host: HTMLElement,
    private events: WorldEvents,
  ) {
    this.ready = this.start()
  }

  private async start() {
    await this.app.init({
      resizeTo: this.host,
      background: '#15161d',
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    })
    if (this.disposed) {
      this.app.destroy(true)
      return
    }
    this.host.appendChild(this.app.canvas)
    this.viewport = new Viewport({
      screenWidth: this.host.clientWidth,
      screenHeight: this.host.clientHeight,
      events: this.app.renderer.events,
      // The camera moves on the same clock as the people, and stops with them in a hidden tab.
      ticker: this.app.ticker,
    })
    this.viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: 0.25, maxScale: 10 })
    this.app.stage.addChild(this.viewport)
    this.viewport.on('clicked', ({ world }) => this.click(world.x, world.y))
    this.app.canvas.addEventListener('dblclick', (event) => {
      const rect = this.app.canvas.getBoundingClientRect()
      const world = this.viewport.toWorld(event.clientX - rect.left, event.clientY - rect.top)
      const hit = this.agentAt(world.x, world.y)
      if (hit) this.events.onJump(hit.sessionId, hit.agentId)
    })
    this.viewport.on('zoomed', () => this.applyDetail())
    this.app.renderer.on('resize', (width, height) => {
      this.viewport.resize(width, height)
      this.frame(false)
      this.dirty = true
    })
    // About 30 frames a second is plenty for pixel art, and nothing at all in a hidden tab. A
    // frame is drawn only when something changed: a still office costs (almost) nothing.
    this.app.ticker.maxFPS = 30
    this.app.ticker.remove(this.app.render, this.app)
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000))
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private onVisibility = () => {
    if (document.hidden) this.app.ticker.stop()
    else this.app.ticker.start()
  }

  destroy() {
    this.disposed = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.ready.then(() => {
      if (this.app.renderer) this.app.destroy(true, { children: true })
    })
  }

  async setOffices(offices: Office[]) {
    await this.ready
    if (this.disposed) return
    const seen = new Set<string>()
    for (const office of offices) {
      seen.add(office.sessionId)
      const floor = this.floors.get(office.sessionId)
      if (floor) floor.update(office)
      else {
        const created = new Floor(office)
        created.scene.setLooks(this.looks)
        created.scene.reduced = this.view.reduced
        this.floors.set(office.sessionId, created)
        this.viewport.addChild(created)
      }
    }
    for (const [id, floor] of this.floors) {
      if (seen.has(id)) continue
      floor.destroy({ children: true })
      this.floors.delete(id)
    }
    // The office asked for has just arrived (or the one shown has closed): move the camera.
    const focused = this.wanted && this.floors.has(this.wanted) ? this.wanted : null
    const moved = focused !== this.focused
    this.focused = focused
    this.arrange(offices.map((office) => office.sessionId))
    if (moved) this.frame(true)
    this.applyDetail()
    this.dirty = true
  }

  /** A grid of offices, most recently active first. */
  private arrange(order: string[]) {
    const floors = order.map((id) => this.floors.get(id)!).filter(Boolean)
    const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(floors.length))))
    let y = 0
    for (let row = 0; row * columns < floors.length; row++) {
      const inRow = floors.slice(row * columns, row * columns + columns)
      let x = 0
      for (const floor of inRow) {
        floor.position.set(x, y)
        x += floor.size.width + GAP
      }
      y += Math.max(...inRow.map((floor) => floor.size.height)) + GAP
    }
    const bounds = this.viewport.getLocalBounds()
    this.viewport.worldWidth = Math.max(1, bounds.width)
    this.viewport.worldHeight = Math.max(1, bounds.height)
    this.frame(false)
  }

  async focus(sessionId: string | null) {
    await this.ready
    if (this.disposed) return
    this.wanted = sessionId
    this.focused = sessionId && this.floors.has(sessionId) ? sessionId : null
    this.frame(true)
  }

  async setView(view: ViewOptions) {
    await this.ready
    this.view = view
    for (const floor of this.floors.values()) floor.scene.reduced = view.reduced
    this.dirty = true
  }

  /** The looks you chose for people, by whose they are. */
  async setLooks(looks: Record<string, LookChoice>) {
    await this.ready
    this.looks = looks
    for (const floor of this.floors.values()) floor.scene.setLooks(looks)
    this.dirty = true
  }

  async select(agentId: string | null) {
    await this.ready
    for (const floor of this.floors.values()) floor.scene.selectedId = agentId
    this.dirty = true
  }

  /** Points the camera at the focused office, or at the whole building. */
  private frame(animate: boolean) {
    if (!this.viewport) return
    const target = this.focused ? this.floors.get(this.focused) : null
    const box = target
      ? { x: target.x, y: target.y, ...target.size }
      : (() => {
          const bounds = this.viewport.getLocalBounds()
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        })()
    if (box.width <= 0 || box.height <= 0) return
    const padding = target ? 0.96 : 0.92
    const scale = Math.min((this.viewport.screenWidth / box.width) * padding, (this.viewport.screenHeight / box.height) * padding)
    const position = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    if (animate && !this.view.reduced) {
      this.viewport.animate({ position, scale, time: 650, ease: 'easeInOutSine', callbackOnComplete: () => this.applyDetail() })
    } else {
      this.viewport.setZoom(scale, true)
      this.viewport.moveCenter(position.x, position.y)
      this.applyDetail()
    }
  }

  private applyDetail() {
    this.dirty = true
    const compact = this.viewport.scale.x < DETAIL_ZOOM
    if (compact === this.compact && this.floors.size > 0) {
      for (const floor of this.floors.values()) floor.scene.setCompact(compact)
      return
    }
    this.compact = compact
    for (const floor of this.floors.values()) floor.scene.setCompact(compact)
  }

  /** The office and agent under a point of the world, if any. */
  private agentAt(x: number, y: number): { sessionId: string; agentId: string } | null {
    for (const [sessionId, floor] of this.floors) {
      const agentId = floor.scene.agentAt(x - floor.x - floor.scene.x, y - floor.y - floor.scene.y)
      if (agentId) return { sessionId, agentId }
    }
    return null
  }

  private click(x: number, y: number) {
    for (const [id, floor] of this.floors) {
      const { width, height } = floor.size
      if (x < floor.x || y < floor.y || x > floor.x + width || y > floor.y + height) continue
      if (this.focused !== id) {
        this.events.onFocus(id)
        return
      }
      const agent = floor.scene.agentAt(x - floor.x - floor.scene.x, y - floor.y - floor.scene.y)
      this.events.onSelect(agent)
      return
    }
    // A click on empty floor between offices: back to the whole building.
    if (this.focused) this.events.onFocus(null)
  }

  private tick(seconds: number) {
    const dt = seconds * speeds[this.view.speed]
    this.elapsed += dt
    // Reduced motion: one still frame (no blinking, typing or blinking lights). Zoomed out,
    // people are small: they move half as often, so the building redraws half as often.
    const frame = this.view.reduced ? 0 : Math.floor(this.elapsed / (this.compact ? 0.6 : 0.3))
    const darkness = themeDarkness(this.view.theme, new Date())
    let changed = this.dirty || this.viewport.dirty
    for (const floor of this.floors.values()) {
      if (floor.scene.tick(Math.min(dt, 0.2), frame) && floor.renderable) changed = true
      if (floor.scene.setDaylight(darkness)) changed = true
    }
    if (!changed) return
    this.cull()
    this.app.render()
    this.dirty = false
    this.viewport.dirty = false
  }

  /** Offices outside the view aren't drawn (they still count for the building's size). */
  private cull() {
    const view = this.viewport.getVisibleBounds()
    for (const floor of this.floors.values()) {
      const { width, height } = floor.size
      floor.renderable =
        floor.x < view.x + view.width && floor.x + width > view.x && floor.y < view.y + view.height && floor.y + height > view.y
    }
  }
}
