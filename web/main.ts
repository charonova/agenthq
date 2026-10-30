import type { Agent, Office } from '../src/core/types.js'
import { bubbleFor, Room } from './room.js'

let offices: Office[] = []
let selected: string | null = null
const minis = new Map<string, Room>()
let big: Room | null = null
const visible = new Set<HTMLCanvasElement>()

const app = document.getElementById('app')!
const stats = document.getElementById('stats')!
const live = document.getElementById('live')!
const liveText = document.getElementById('live-text')!

// Only canvases on screen are drawn.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement
    if (entry.isIntersecting) visible.add(canvas)
    else visible.delete(canvas)
  }
})

// ── Live data ────────────────────────────────────────────────────────────────

function receive(data: string) {
  offices = JSON.parse(data) as Office[]
  live.className = 'live on'
  liveText.textContent = 'Live'
  render()
}

// `?once` loads the offices a single time (for screenshots); otherwise they stream in as they change.
if (new URLSearchParams(location.search).has('once')) {
  void fetch('/api/offices').then((response) => response.text()).then(receive)
} else {
  const events = new EventSource('/events')
  events.addEventListener('offices', (event) => receive((event as MessageEvent<string>).data))
  events.onerror = () => {
    live.className = 'live off'
    liveText.textContent = 'Reconnecting…'
  }
}
window.addEventListener('hashchange', () => {
  selected = null
  render(true)
})

// ── Views ────────────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const everyone = (office: Office): Agent[] => [office.manager, ...office.staff, ...office.interns]
const count = (agents: Agent[], test: (agent: Agent) => boolean) => agents.filter(test).length

function currentOffice(): Office | null {
  const match = location.hash.match(/^#\/office\/(.+)$/)
  return match ? offices.find((office) => office.sessionId === decodeURIComponent(match[1]!)) ?? null : null
}

let lastView = ''

function render(force = false) {
  renderStats()
  const office = currentOffice()
  const view = office ? `office:${office.sessionId}` : 'building'
  if (view !== lastView || force) {
    lastView = view
    app.replaceChildren()
    visible.clear()
    observer.disconnect()
    big = null
    if (office) buildOffice(office)
    else buildBuilding()
  } else if (office) {
    refreshOffice(office)
  } else {
    refreshBuilding()
  }
}

function renderStats() {
  const all = offices.flatMap(everyone)
  stats.replaceChildren(
    chip('🏢', offices.length, offices.length === 1 ? 'office' : 'offices'),
    chip('⌨️', count(all, (a) => a.state === 'working'), 'working'),
    chip('✋', count(all, (a) => a.state === 'waiting'), 'need you'),
    chip('☕', count(all, (a) => a.rest === 'coffee'), 'on a break'),
  )
}

function chip(icon: string, value: number, label: string) {
  const node = el('span', 'chip', `${icon} `)
  node.append(el('b', undefined, String(value)), ` ${label}`)
  return node
}

// The building: one card per office.

function buildBuilding() {
  if (offices.length === 0) {
    const empty = el('div', 'empty')
    empty.append(el('div', 'big', '🏢'), el('h2', undefined, 'Every office is closed'), el('p', undefined, 'Start a Claude Code session and its office opens here, with its manager, its team and their helpers.'))
    app.append(empty)
    return
  }
  const grid = el('div', 'building')
  for (const office of offices) grid.append(card(office))
  app.append(grid)
}

function refreshBuilding() {
  const grid = app.querySelector('.building')
  const ids = offices.map((o) => o.sessionId).join(',')
  if (!grid || grid.getAttribute('data-ids') !== ids) {
    lastView = ''
    render()
    app.querySelector('.building')?.setAttribute('data-ids', ids)
    return
  }
  for (const office of offices) {
    minis.get(office.sessionId)?.update(office)
    const head = grid.querySelector(`[data-id="${CSS.escape(office.sessionId)}"] .head`)
    if (head) head.replaceWith(cardHead(office))
  }
}

function card(office: Office) {
  const node = el('div', 'card')
  node.dataset.id = office.sessionId
  node.append(cardHead(office))
  let room = minis.get(office.sessionId)
  if (!room) {
    room = new Room('mini')
    minis.set(office.sessionId, room)
  }
  room.update(office)
  node.append(room.canvas)
  observer.observe(room.canvas)
  node.addEventListener('click', () => (location.hash = `#/office/${encodeURIComponent(office.sessionId)}`))
  return node
}

function cardHead(office: Office) {
  const all = everyone(office)
  const working = count(all, (a) => a.state === 'working')
  const waiting = count(all, (a) => a.state === 'waiting')
  const head = el('div', 'head')
  head.append(el('span', `light ${waiting ? 'waiting' : working ? 'busy' : ''}`))
  const names = el('div')
  names.style.minWidth = '0'
  names.append(el('div', 'name', office.project), el('div', 'title', office.title ?? 'Untitled session'))
  const counts = el('div', 'counts')
  counts.append(el('span', undefined, `👥 ${all.filter((a) => a.state !== 'gone').length}`), el('span', undefined, `⌨️ ${working}`))
  if (waiting) counts.append(el('span', undefined, `✋ ${waiting}`))
  head.append(names, counts)
  return head
}

// One office, big, with everyone listed beside it.

function buildOffice(office: Office) {
  const layout = el('div', 'office')
  const stage = el('div', 'stage')
  const top = el('div', 'top')
  const back = el('a', 'back', '← Building')
  back.href = '#/'
  const names = el('div')
  names.append(el('h1', undefined, office.project), el('div', 'title', [office.title, office.cwd].filter(Boolean).join(' · ')))
  top.append(back, names)
  big = new Room('full')
  big.update(office)
  big.canvas.addEventListener('click', (event) => {
    const rect = big!.canvas.getBoundingClientRect()
    const scale = big!.canvas.width / rect.width
    const id = big!.agentAt((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale)
    select(id)
  })
  stage.append(top, big.canvas)
  observer.observe(big.canvas)
  const side = el('aside', 'side')
  layout.append(stage, side)
  app.append(layout)
  refreshSide(office)
}

function refreshOffice(office: Office) {
  big?.update(office)
  refreshSide(office)
}

function select(id: string | null) {
  selected = id
  if (big) big.selected = id
  const office = currentOffice()
  if (office) refreshSide(office)
}

function refreshSide(office: Office) {
  const side = app.querySelector('.side')
  if (!side) return
  const scroll = side.querySelector('.people')?.scrollTop ?? 0
  const list = el('div', 'people')
  const row = (agent: Agent, role: string) => {
    const node = el('div', `person ${agent.role === 'intern' ? 'intern' : ''} ${agent.id === selected ? 'selected' : ''}`)
    node.append(el('div', 'emoji', emojiFor(agent)))
    const who = el('div', 'who', agent.role === 'intern' ? agent.task ?? agent.name : agent.name)
    who.append(el('small', undefined, role))
    node.append(who, el('div', 'what', describe(agent)))
    node.addEventListener('click', () => select(agent.id === selected ? null : agent.id))
    return node
  }
  list.append(row(office.manager, 'manager'))
  for (const member of office.staff) {
    list.append(row(member, 'staff'))
    for (const intern of office.interns.filter((i) => i.parentId === member.id)) list.append(row(intern, 'intern'))
  }
  for (const intern of office.interns.filter((i) => i.parentId === office.sessionId)) list.append(row(intern, 'intern'))
  const heading = el('h3', undefined, `${everyone(office).filter((a) => a.state !== 'gone').length} in the office · ${office.wentHome} went home`)
  const children: Node[] = [heading, list]
  const agent = everyone(office).find((a) => a.id === selected)
  if (agent) children.push(details(agent))
  side.replaceChildren(...children)
  list.scrollTop = scroll
}

function details(agent: Agent) {
  const box = el('div', 'details')
  box.append(el('h4', undefined, `${emojiFor(agent)} ${agent.role === 'manager' ? 'Manager' : agent.name}`))
  const dl = el('dl')
  const item = (label: string, value: string | null | undefined) => {
    if (!value) return
    dl.append(el('dt', undefined, label), el('dd', undefined, value))
  }
  item('Doing', describe(agent))
  item('Task', agent.task)
  item('Tool', agent.tool ? `${agent.tool.name}${agent.tool.target ? ` · ${agent.tool.target}` : ''}` : null)
  item('Model', agent.model)
  item('Context', agent.contextTokens ? `${Math.round(agent.contextTokens / 1000)}k tokens` : null)
  item('Last seen', ago(agent.updatedAt))
  box.append(dl)
  if (agent.lastText) box.append(el('div', 'said', `“${agent.lastText}”`))
  return box
}

function emojiFor(agent: Agent): string {
  if (agent.state === 'waiting') return '✋'
  if (agent.state === 'done') return '✅'
  if (agent.state === 'idle') return agent.rest === 'couch' ? '💤' : agent.rest === 'coffee' ? '☕' : agent.rest === 'watching' ? '👀' : '🪑'
  return agent.role === 'manager' ? '👔' : agent.role === 'intern' ? '🧑‍🎓' : '🧑‍💻'
}

function describe(agent: Agent): string {
  switch (agent.state) {
    case 'waiting':
      return 'Waiting for you'
    case 'done':
      return 'Just finished'
    case 'idle':
      return agent.rest === 'couch' ? `On the couch · ${ago(agent.updatedAt)}` : agent.rest === 'coffee' ? `Coffee break · ${ago(agent.updatedAt)}` : agent.rest === 'watching' ? 'Watching the team' : 'At the desk'
    default: {
      const bubble = bubbleFor(agent)
      return bubble === '💭' ? 'Thinking' : bubble ?? 'Working'
    }
  }
}

function ago(time: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

// ── The animation loop: ~20 frames a second, only for what's on screen, never in a hidden tab. ──

let last = performance.now()
function loop(time: number) {
  const dt = Math.min(0.1, (time - last) / 1000)
  if (dt >= 0.05 && !document.hidden) {
    last = time
    const rooms = big ? [big] : [...minis.values()]
    for (const room of rooms) {
      room.step(dt)
      if (visible.has(room.canvas)) room.render(time)
    }
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
