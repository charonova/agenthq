import type { Agent, Office } from '@agenthq/core'

/** How the office looks and moves, as chosen in the settings (pure: tested). */

export type Theme = 'clock' | 'day' | 'night'
export type Speed = 'slow' | 'normal' | 'fast'
/** "system" follows the computer's own "reduce motion" setting. */
export type Motion = 'system' | 'full' | 'reduced'

/** How much faster or slower than normal people walk and things animate. */
export const speeds: Record<Speed, number> = { slow: 0.6, normal: 1, fast: 1.7 }

/** The night's darkness at its deepest. */
export const NIGHT = 0.28

/** How dark the office is at this hour: day, a dim evening, dark at night. */
export function darknessAt(date: Date): number {
  const hour = date.getHours() + date.getMinutes() / 60
  if (hour >= 7 && hour < 18) return 0
  if (hour >= 18 && hour < 20) return ((hour - 18) / 2) * NIGHT
  if (hour >= 5 && hour < 7) return ((7 - hour) / 2) * NIGHT
  return NIGHT
}

/** The darkness for a theme: the clock's, or always day, or always night. */
export function themeDarkness(theme: Theme, date: Date): number {
  return theme === 'day' ? 0 : theme === 'night' ? NIGHT : darknessAt(date)
}

/** Whether to keep motion down: chosen here, or asked for by the computer. */
export function reducedMotion(motion: Motion, systemReduced: boolean): boolean {
  return motion === 'reduced' || (motion === 'system' && systemReduced)
}

export interface Hiding {
  /** Offices hidden one by one, by session. */
  hidden: string[]
  hideEnded: boolean
  hideCodex: boolean
}

/** The offices to show: hidden ones, ended ones and Codex's stay out when you asked. */
export function visibleOffices(offices: Office[], hiding: Hiding): Office[] {
  const hidden = new Set(hiding.hidden)
  return offices.filter(
    (office) =>
      !hidden.has(office.sessionId) && !(hiding.hideEnded && office.ended) && !(hiding.hideCodex && office.kind === 'codex'),
  )
}

/**
 * Whose look a choice belongs to. Teammates and helpers keep their name from session to session;
 * a manager is its project's.
 */
export function lookKeyOf(agent: Pick<Agent, 'role' | 'name'>, office: Pick<Office, 'project'>): string {
  return agent.role === 'manager' ? `manager:${office.project}` : `${agent.role}:${agent.name}`
}
