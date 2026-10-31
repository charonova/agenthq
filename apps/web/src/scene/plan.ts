import type { Activity, Agent, Office } from '@agenthq/core'
import type { Pose } from './art/people'
import { MANAGER_DESK, T, deskOf, lounge, props, seatAt, type Point } from './layout'

/** Where someone should be, and how they stand there. */
export interface Spot extends Point {
  pose: Pose
  /** Bubbles of people sharing a spot are staggered, so they don't cover each other. */
  lift: number
}

export interface Plan {
  spot: Spot
  bubble: string | null
}

/** Shared places, with room for several people side by side. */
const shared = {
  read: { x: props.bookshelf * T + 16, y: 62, pose: 'read', spread: 12 },
  run: { x: props.rack * T + 8, y: 62, pose: 'stand', spread: 12 },
  test: { x: props.lab * T + 16, y: 62, pose: 'stand', spread: 12 },
  plan: { x: props.whiteboard * T + 16, y: 62, pose: 'stand', spread: 12 },
  web: { x: props.window * T + 16, y: 62, pose: 'stand', spread: 12 },
  coffee: { x: props.kitchen * T + 10, y: 62, pose: 'drink', spread: 14 },
  meeting: { x: props.meetingTable.tx * T + 12, y: props.meetingTable.ty * T + 6, pose: 'stand', spread: 14 },
  couch: { x: (lounge.couches[0].tx + 2) * T, y: lounge.couches[0].ty * T + 13, pose: 'sleep', spread: 20 },
  couch2: { x: (lounge.couches[1].tx + 2) * T, y: lounge.couches[1].ty * T + 13, pose: 'sleep', spread: 20 },
  watch: { x: 6 * T + 8, y: 6 * T + 12, pose: 'stand', spread: 10 },
} satisfies Record<string, { x: number; y: number; pose: Pose; spread: number }>

type Place = keyof typeof shared

export const activityIcon: Record<Activity, string> = {
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

/** Names a teammate uses for the lead when it sends a message. */
const leadNames = new Set(['main', 'lead', 'team-lead', 'manager'])

/** Where everyone in an office goes, and what their bubble says. */
export function planOffice(office: Office): Map<string, Plan> {
  const crowd = new Map<Place, number>()
  const at = (place: Place): Spot => {
    const base = shared[place]
    const n = crowd.get(place) ?? 0
    crowd.set(place, n + 1)
    const side = n % 2 === 0 ? 1 : -1
    return {
      x: base.x + side * Math.ceil(n / 2) * base.spread,
      y: base.y + (base.pose === 'sleep' ? 0 : (n % 3) * 2),
      pose: base.pose,
      lift: (n % 2) * 9,
    }
  }
  const plans = new Map<string, Plan>()
  for (const agent of [office.manager, ...office.staff, ...office.interns]) {
    if (agent.state === 'gone') continue
    plans.set(agent.id, { spot: spotFor(agent, office, at), bubble: bubbleFor(agent) })
  }
  return plans
}

function spotFor(agent: Agent, office: Office, at: (place: Place) => Spot): Spot {
  const home = homeOf(agent, office)
  const sit = (pose: Pose): Spot => ({ ...home, pose, lift: 0 })
  switch (agent.state) {
    case 'idle':
      if (agent.rest === 'coffee') return at('coffee')
      if (agent.rest === 'watching') return at('watch')
      if (agent.rest === 'couch') return seatOnCouch(at)
      return sit('sit')
    case 'waiting':
      return sit('raise')
    case 'done':
      return sit('sit')
    default:
      break
  }
  switch (agent.activity) {
    case 'read':
    case 'run':
    case 'test':
    case 'plan':
    case 'web':
      return at(agent.activity)
    case 'message':
      return visit(agent, office) ?? at('meeting')
    default:
      return sit('type')
  }
}

/** Two couches of three; whoever's left naps standing by the coffee machine. */
function seatOnCouch(at: (place: Place) => Spot): Spot {
  const spot = at('couch')
  if (spot.x >= shared.couch.x - shared.couch.spread && spot.x <= shared.couch.x + shared.couch.spread) return spot
  const second = at('couch2')
  if (second.x >= shared.couch2.x - shared.couch2.spread && second.x <= shared.couch2.x + shared.couch2.spread) return second
  return at('coffee')
}

/** Messaging a teammate: walk over and stand beside their desk (the lead is in the glass office). */
function visit(agent: Agent, office: Office): Spot | null {
  const to = agent.tool?.target?.toLowerCase()
  if (!to) return null
  if (leadNames.has(to)) {
    const seat = seatAt(MANAGER_DESK.tx, MANAGER_DESK.ty)
    return { x: seat.x + 18, y: seat.y - 10, pose: 'stand', lift: 0 }
  }
  const index = office.staff.findIndex((member) => member.name.toLowerCase() === to)
  if (index < 0 || office.staff[index]!.id === agent.id) return null
  const { tx, ty } = deskOf(index)
  return { x: tx * T + 36, y: ty * T - 6, pose: 'stand', lift: 0 }
}

/** The agent's own chair: the manager's desk, a staff desk, or the table beside the boss. */
export function homeOf(agent: Agent, office: Office): Point {
  if (agent.role === 'manager') return seatAt(MANAGER_DESK.tx, MANAGER_DESK.ty)
  if (agent.role === 'staff') {
    const { tx, ty } = deskOf(office.staff.findIndex((member) => member.id === agent.id))
    return seatAt(tx, ty)
  }
  const siblings = office.interns.filter((intern) => intern.parentId === agent.parentId)
  const n = siblings.findIndex((intern) => intern.id === agent.id)
  const boss = office.staff.findIndex((member) => member.id === agent.parentId)
  const desk = boss >= 0 ? deskOf(boss) : MANAGER_DESK
  // Two places at the side table; more interns gather at the meeting table.
  if (n < 2) return { x: (desk.tx + 2 + n) * T + 8, y: desk.ty * T + 6 }
  return { x: shared.meeting.x + (n - 1) * 12, y: shared.meeting.y }
}

const short = (text: string, max = 22) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

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
      if (activity === 'message' && target) return `💬 → ${short(target, 18)}`
      return target ? `${activityIcon[activity]} ${short(target)}` : activityIcon[activity]
    }
    default:
      return null
  }
}

/** A short line on what someone is doing, for lists. */
export function describe(agent: Agent, now = Date.now()): string {
  const ago = agoText(agent.updatedAt, now)
  switch (agent.state) {
    case 'waiting':
      return 'Waiting for you'
    case 'done':
      return 'Just finished'
    case 'idle':
      if (agent.rest === 'couch') return `On the couch · ${ago}`
      if (agent.rest === 'coffee') return `Coffee break · ${ago}`
      if (agent.rest === 'watching') return 'Watching the team'
      return 'At the desk'
    case 'gone':
      return 'Went home'
    default: {
      const bubble = bubbleFor(agent)
      return bubble === '💭' ? 'Thinking' : (bubble ?? 'Working')
    }
  }
}

export function agoText(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

export function stateEmoji(agent: Agent): string {
  if (agent.state === 'waiting') return '✋'
  if (agent.state === 'done') return '✅'
  if (agent.state === 'idle')
    return agent.rest === 'couch' ? '💤' : agent.rest === 'coffee' ? '☕' : agent.rest === 'watching' ? '👀' : '🪑'
  return agent.role === 'manager' ? '👔' : agent.role === 'intern' ? '🧑‍🎓' : '🧑‍💻'
}
