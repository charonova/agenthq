import type { Ask, Office } from '@agenthq/core'
import { useEffect } from 'react'
import { useAsks } from './asks'
import { useOffices } from './store'

/**
 * Keeps the store in step with the server: offices stream in as Server-Sent Events whenever
 * something changes. `?once` loads them a single time instead (for screenshots and tests).
 */
export function useOfficeStream() {
  useEffect(() => {
    const { setOffices, setConnection } = useOffices.getState()
    const receive = (data: string) => setOffices(JSON.parse(data) as Office[])

    if (new URLSearchParams(location.search).has('once')) {
      const controller = new AbortController()
      fetch('/api/offices', { signal: controller.signal })
        .then((response) => response.text())
        .then(receive)
        .catch(() => setConnection('offline'))
      fetch('/api/asks', { headers: { 'X-AgentHQ': '1' }, signal: controller.signal })
        .then((response) => response.json() as Promise<{ enabled: boolean; asks: Ask[] }>)
        .then(useAsks.getState().receive)
        .catch(() => undefined)
      return () => controller.abort()
    }

    const events = new EventSource('/events')
    events.addEventListener('offices', (event) => receive((event as MessageEvent<string>).data))
    events.addEventListener('asks', (event) => useAsks.getState().receive(JSON.parse((event as MessageEvent<string>).data)))
    events.onerror = () => setConnection('offline')
    return () => events.close()
  }, [])
}

/** The focused office lives in the address (`#/office/<id>`), so back and links work. */
export function useHashRoute() {
  useEffect(() => {
    const fromHash = () => {
      const match = location.hash.match(/^#\/office\/(.+)$/)
      const id = match ? decodeURIComponent(match[1]!) : null
      if (useOffices.getState().focusedId !== id) useOffices.getState().focus(id)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    const unsubscribe = useOffices.subscribe((state, previous) => {
      if (state.focusedId === previous.focusedId) return
      const hash = state.focusedId ? `#/office/${encodeURIComponent(state.focusedId)}` : '#/'
      if (location.hash !== hash) history.pushState(null, '', hash)
    })
    return () => {
      window.removeEventListener('hashchange', fromHash)
      unsubscribe()
    }
  }, [])
}
