import { useEffect } from 'react'
import { create } from 'zustand'
import { useSettings } from './store'
import { reducedMotion } from './view'

/** Whether motion is kept down now: by the settings, or by the computer's own "reduce motion". */
export const useReducedMotion = create<{ reduced: boolean }>()(() => ({ reduced: false }))

/** Follows both, and marks the page so its own animations stop too. */
export function useMotion() {
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const apply = () => {
      const reduced = reducedMotion(useSettings.getState().motion, query?.matches ?? false)
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
      if (useReducedMotion.getState().reduced !== reduced) useReducedMotion.setState({ reduced })
    }
    apply()
    query?.addEventListener('change', apply)
    const unsubscribe = useSettings.subscribe((settings, previous) => {
      if (settings.motion !== previous.motion) apply()
    })
    return () => {
      query?.removeEventListener('change', apply)
      unsubscribe()
    }
  }, [])
}
