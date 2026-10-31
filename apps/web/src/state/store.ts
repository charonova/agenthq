import type { Agent, Office } from '@agenthq/core'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { LookChoice } from '../scene/art/people'
import { visibleOffices, type Motion, type Speed, type Theme } from './view'

export type Connection = 'connecting' | 'live' | 'offline'

interface OfficeState {
  /** The offices shown: every live one, less those hidden in the settings. */
  offices: Office[]
  /** Every live office, hidden or not. */
  allOffices: Office[]
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
  allOffices: [],
  connection: 'connecting',
  focusedId: null,
  selectedAgentId: null,
  setOffices: (allOffices) =>
    set((state) => {
      const offices = visibleOffices(allOffices, useSettings.getState())
      return {
        offices,
        allOffices,
        connection: 'live',
        // An office that closed (or was hidden) takes the camera back to the building.
        focusedId: state.focusedId && offices.some((o) => o.sessionId === state.focusedId) ? state.focusedId : null,
      }
    }),
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
  /** Day and night: following the clock, or always one. */
  theme: Theme
  speed: Speed
  motion: Motion
  /** Offices hidden one by one, by session. */
  hidden: string[]
  hideEnded: boolean
  hideCodex: boolean
  /** Looks chosen for people, by whose they are (`lookKeyOf`). */
  looks: Record<string, LookChoice>
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
      theme: 'clock',
      speed: 'normal',
      motion: 'system',
      hidden: [],
      hideEnded: false,
      hideCodex: false,
      looks: {},
      set: (change) => set(change),
    }),
    { name: 'agenthq-settings', storage: createJSONStorage(() => safeStorage), partialize: ({ set: _set, ...rest }) => rest },
  ),
)

/** The settings panel: open or not, and the part to show first. */
export type SettingsSection = 'office' | 'alerts' | 'offices' | 'people' | 'claude'
export const useSettingsPanel = create<{
  open: boolean
  section: SettingsSection | null
  show: (section?: SettingsSection) => void
  close: () => void
}>()((set) => ({
  open: false,
  section: null,
  show: (section) => set({ open: true, section: section ?? null }),
  close: () => set({ open: false, section: null }),
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

// Hiding or showing offices applies at once, not at the next change.
useSettings.subscribe((settings, previous) => {
  if (
    settings.hidden === previous.hidden &&
    settings.hideEnded === previous.hideEnded &&
    settings.hideCodex === previous.hideCodex
  )
    return
  const { allOffices, setOffices, connection } = useOffices.getState()
  if (connection === 'live') setOffices(allOffices)
})
