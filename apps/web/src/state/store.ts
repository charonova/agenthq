import type { Agent, Office } from '@agenthq/core'
import { create } from 'zustand'

export type Connection = 'connecting' | 'live' | 'offline'

interface OfficeState {
  offices: Office[]
  connection: Connection
  /** The office the camera is on, or null for the whole building. */
  focusedId: string | null
  selectedAgentId: string | null
  setOffices: (offices: Office[]) => void
  setConnection: (connection: Connection) => void
  focus: (sessionId: string | null) => void
  select: (agentId: string | null) => void
}

export const useOffices = create<OfficeState>()((set) => ({
  offices: [],
  connection: 'connecting',
  focusedId: null,
  selectedAgentId: null,
  setOffices: (offices) =>
    set((state) => ({
      offices,
      connection: 'live',
      // An office that closed takes the camera back to the building.
      focusedId: state.focusedId && offices.some((o) => o.sessionId === state.focusedId) ? state.focusedId : null,
    })),
  setConnection: (connection) => set({ connection }),
  focus: (focusedId) => set({ focusedId, selectedAgentId: null }),
  select: (selectedAgentId) => set({ selectedAgentId }),
}))

export const everyone = (office: Office): Agent[] => [office.manager, ...office.staff, ...office.interns]

export function totals(offices: Office[]) {
  const agents = offices.flatMap(everyone)
  return {
    offices: offices.length,
    working: agents.filter((a) => a.state === 'working').length,
    waiting: agents.filter((a) => a.state === 'waiting').length,
    resting: agents.filter((a) => a.rest === 'coffee' || a.rest === 'couch').length,
  }
}
