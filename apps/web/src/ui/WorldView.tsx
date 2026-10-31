import { useEffect, useRef } from 'react'
import { World } from '../scene/World'
import { useOffices } from '../state/store'

/** Hosts the PixiJS world and keeps it in step with the store, both ways. */
export function WorldView() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { focus, select } = useOffices.getState()
    const world = new World(host.current!, { onFocus: focus, onSelect: select })
    const sync = () => {
      const state = useOffices.getState()
      void world.setOffices(state.offices)
      void world.focus(state.focusedId)
      void world.select(state.selectedAgentId)
    }
    sync()
    const unsubscribe = useOffices.subscribe((state, previous) => {
      if (state.offices !== previous.offices) void world.setOffices(state.offices)
      if (state.focusedId !== previous.focusedId) void world.focus(state.focusedId)
      if (state.selectedAgentId !== previous.selectedAgentId) void world.select(state.selectedAgentId)
    })
    return () => {
      unsubscribe()
      world.destroy()
    }
  }, [])

  return <div className="world" ref={host} />
}
