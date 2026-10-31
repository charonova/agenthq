import type { Agent, Office } from '@agenthq/core'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

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
  /** Goes to an agent: its office, with it selected. */
  jump: (sessionId: string, agentId: string) => void
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
  jump: (focusedId, selectedAgentId) => set({ focusedId, selectedAgentId }),
}))

interface Settings {
  /** Desktop notifications when an agent needs you. */
  notify: boolean
  /** A chime with each alert. */
  sound: boolean
  /** Also tell when a session's manager finishes its turn. */
  finished: boolean
  set: (change: Partial<Omit<Settings, 'set'>>) => void
}

/** Browser storage can be missing or refuse (private windows): settings then last for the visit. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Not saved: fine for a preference.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // Nothing to remove.
    }
  },
}

/** This viewer's preferences, kept in this browser. */
export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      notify: false,
      sound: true,
      finished: false,
      set: (change) => set(change),
    }),
    { name: 'agenthq-settings', storage: createJSONStorage(() => safeStorage), partialize: ({ set: _set, ...rest }) => rest },
  ),
)

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
