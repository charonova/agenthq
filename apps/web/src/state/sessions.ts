import { create } from 'zustand'
import { useChat } from './conversation'
import { useToast } from './jump'
import { useOffices } from './store'

/** Sessions run from the page: starting one, messaging it, interrupting it, ending it. */

export type Model = '' | 'opus' | 'sonnet' | 'haiku'
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'auto'

const post = async <T>(action: string, body: object): Promise<T> => {
  const response = await fetch(`/api/sessions/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AgentHQ': '1' },
    body: JSON.stringify(body),
  })
  const result = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result
}

interface SessionsState {
  /** The new-session dialog is open. */
  composing: boolean
  /** A session just started: its conversation opens as soon as its office does. */
  opening: string | null
  compose: (open: boolean) => void
}

export const useSessions = create<SessionsState>()((set) => ({
  composing: false,
  opening: null,
  compose: (composing) => set({ composing }),
}))

const RECENT = 'agenthq-folders'
/** Folders sessions were started in, newest first, kept in this browser. */
export function recentFolders(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).filter((f) => typeof f === 'string')
  } catch {
    return []
  }
}
function remember(folder: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([folder, ...recentFolders().filter((f) => f !== folder)].slice(0, 12)))
  } catch {
    // Not remembered: fine.
  }
}

export async function startSession(options: { cwd: string; text: string; model: Model; mode: Mode }): Promise<boolean> {
  try {
    const { sessionId } = await post<{ sessionId: string }>('start', options)
    remember(options.cwd.trim())
    useSessions.setState({ composing: false, opening: sessionId })
    useToast.getState().show('Starting the session…', 'info')
    return true
  } catch (error) {
    useToast.getState().show(`Couldn’t start it: ${(error as Error).message}`, 'error')
    return false
  }
}

/** Sends a message: to a session AgentHQ runs, or resumes an ended one here with it. */
export async function sendMessage(sessionId: string, text: string): Promise<boolean> {
  try {
    await post('send', { sessionId, text })
    return true
  } catch (error) {
    useToast.getState().show(`Couldn’t send it: ${(error as Error).message}`, 'error')
    return false
  }
}

export async function interrupt(sessionId: string): Promise<void> {
  try {
    await post('interrupt', { sessionId })
    useToast.getState().show('Interrupted')
  } catch (error) {
    useToast.getState().show((error as Error).message, 'error')
  }
}

export async function endSession(sessionId: string): Promise<void> {
  try {
    await post('stop', { sessionId })
    useToast.getState().show('The session ended. Send a message to resume it here.')
  } catch (error) {
    useToast.getState().show((error as Error).message, 'error')
  }
}

/** Opens a just-started session's conversation once its office shows up. */
export function followNewSessions(): () => void {
  return useOffices.subscribe((state) => {
    const id = useSessions.getState().opening
    if (!id || !state.offices.some((office) => office.sessionId === id)) return
    useSessions.setState({ opening: null })
    useOffices.getState().jump(id, id)
    useChat.getState().show(id, id)
  })
}
