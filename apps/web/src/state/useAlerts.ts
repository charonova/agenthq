import type { Office } from '@agenthq/core'
import { useEffect } from 'react'
import { detectAlerts, titleFor, type Alert } from './alerts'
import { chime } from './sound'
import { useOffices, useSettings } from './store'
import { goToAgent } from './asks'

/** Rings, notifies and updates the tab title as agents start waiting for you. */
export function useAlerts() {
  useEffect(() => {
    let previous: Office[] | null = null
    return useOffices.subscribe((state) => {
      if (state.connection !== 'live' || state.offices === previous) return
      document.title = titleFor(state.offices)
      const alerts = detectAlerts(previous, state.offices)
      previous = state.offices
      const settings = useSettings.getState()
      const wanted = alerts.filter((alert) => alert.kind === 'waiting' || settings.finished)
      if (wanted.length === 0) return
      if (settings.sound) chime(wanted.some((alert) => alert.kind === 'waiting') ? 'waiting' : 'finished')
      if (settings.notify) for (const alert of wanted.slice(0, 3)) notify(alert)
    })
  }, [])
}

function notify(alert: Alert) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // The same agent replaces its own notification instead of stacking.
  const notification = new Notification(alert.title, { body: alert.body, tag: `${alert.officeId}/${alert.agentId}` })
  notification.onclick = () => {
    window.focus()
    goToAgent(alert.officeId, alert.agentId)
    notification.close()
  }
}

/** Asks for permission to notify; true when allowed. */
export async function allowNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}
