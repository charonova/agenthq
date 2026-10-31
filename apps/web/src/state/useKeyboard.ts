import { useEffect } from 'react'
import { useChat } from './conversation'
import { useSessions } from './sessions'
import { useOffices, useSettingsPanel } from './store'

/**
 * Esc steps back one thing at a time, whatever has focus: the new-session dialog, the settings,
 * the conversation, the selected person, then the office (back to the building). Focus goes
 * back to where you were, so Tab and Enter carry on from there.
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A menu or a typed composition (an IME) handles its own Esc.
      if (event.isComposing || (event.target as HTMLElement | null)?.tagName === 'SELECT') return
      const offices = useOffices.getState()
      if (useSessions.getState().composing) useSessions.getState().compose(false)
      else if (useSettingsPanel.getState().open) {
        useSettingsPanel.getState().close()
        focusSoon('.gear')
      } else if (useChat.getState().open) {
        const { agentId } = useChat.getState().open!
        useChat.getState().close()
        focusSoon(`.person[data-agent="${CSS.escape(agentId)}"]`)
      } else if (offices.selectedAgentId) {
        const agentId = offices.selectedAgentId
        offices.select(null)
        focusSoon(`.person[data-agent="${CSS.escape(agentId)}"]`)
      } else if (offices.focusedId) {
        const sessionId = offices.focusedId
        offices.focus(null)
        focusSoon(`.office-row[data-session="${CSS.escape(sessionId)}"]`)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Focuses an element once React has drawn it. */
export function focusSoon(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus())
}
