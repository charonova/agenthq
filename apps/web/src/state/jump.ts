import type { JumpResult } from '@agenthq/core'
import { create } from 'zustand'

interface Toast {
  id: number
  text: string
  tone: 'ok' | 'info' | 'error'
}

interface ToastState {
  toast: Toast | null
  show: (text: string, tone?: Toast['tone']) => void
}

let next = 0
export const useToast = create<ToastState>()((set, get) => ({
  toast: null,
  show: (text, tone = 'ok') => {
    const id = ++next
    set({ toast: { id, text, tone } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 4500)
  },
}))

/**
 * Brings a session's window forward (its terminal tab or editor window). Teammates and helpers
 * run inside their session, so they go there too. When it can't, the command that resumes the
 * session is copied instead.
 */
export async function goToSession(sessionId: string): Promise<void> {
  const { show } = useToast.getState()
  try {
    const response = await fetch('/api/jump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AgentHQ': '1' },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? response.statusText)
    const result = (await response.json()) as JumpResult
    if (result.done === 'copy' && result.command) {
      await navigator.clipboard.writeText(result.command).catch(() => undefined)
      show(`${result.message}: ${result.command}`, 'info')
    } else {
      show(result.message)
    }
  } catch (error) {
    show(`Couldn’t go there: ${(error as Error).message}`, 'error')
  }
}
