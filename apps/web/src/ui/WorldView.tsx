import { useEffect, useRef } from 'react'
import { World } from '../scene/World'
import { goToSession } from '../state/jump'
import { useOffices, useSettings } from '../state/store'
import { useReducedMotion } from '../state/useMotion'
import { useReplay, withReplay } from '../state/replay'

/** Hosts the PixiJS world and keeps it in step with the store, both ways. */
export function WorldView() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { focus, select } = useOffices.getState()
    const world = new World(host.current!, {
      onFocus: focus,
      onSelect: select,
      onJump: (sessionId, agentId) => {
        useOffices.getState().jump(sessionId, agentId)
        void goToSession(sessionId)
      },
    })
    const applySettings = () => {
      const settings = useSettings.getState()
      void world.setView({
        theme: settings.theme,
        speed: settings.speed,
        reduced: useReducedMotion.getState().reduced,
        talks: settings.talks,
      })
      void world.setLooks(settings.looks)
    }
    applySettings()
    const unsubscribeSettings = useSettings.subscribe(applySettings)
    const unsubscribeMotion = useReducedMotion.subscribe(applySettings)
    // A session being replayed shows as it was, the rest live.
    const shown = () => withReplay(useOffices.getState().offices, useReplay.getState())
    const unsubscribeReplay = useReplay.subscribe((state, previous) => {
      if (state.t !== previous.t || state.data !== previous.data) void world.setOffices(shown())
    })
    const sync = () => {
      const state = useOffices.getState()
      void world.setOffices(shown())
      void world.focus(state.focusedId)
      void world.select(state.selectedAgentId)
    }
    sync()
    const unsubscribe = useOffices.subscribe((state, previous) => {
      if (state.offices !== previous.offices) void world.setOffices(shown())
      if (state.focusedId !== previous.focusedId) void world.focus(state.focusedId)
      if (state.selectedAgentId !== previous.selectedAgentId) void world.select(state.selectedAgentId)
    })
    return () => {
      unsubscribe()
      unsubscribeSettings()
      unsubscribeMotion()
      unsubscribeReplay()
      world.destroy()
    }
  }, [])

  return <div className="world" ref={host} />
}
