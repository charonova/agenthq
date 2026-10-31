import type { Ask, AskAnswer } from '@agenthq/core'
import { create } from 'zustand'
import { useChat } from './conversation'
import { useToast } from './jump'
import { useOffices } from './store'

/** What the server sends: prompts waiting on you, and its switches. */
export interface Switches {
  /** Answering from AgentHQ is on (its hook is installed). */
  enabled: boolean
  /** Typing into sessions open in Terminal or iTerm2 is on. */
  typing?: boolean
  /** It can be turned on here (macOS). */
  canType?: boolean
  asks: Ask[]
}

interface AsksState extends Required<Switches> {
  receive: (data: Switches) => void
}

export const useAsks = create<AsksState>()((set) => ({
  enabled: false,
  typing: false,
  canType: false,
  asks: [],
  receive: ({ enabled, asks, typing = false, canType = false }) => set({ enabled, asks, typing, canType }),
}))

const post = async (path: string, body: object) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AgentHQ': '1' },
    body: JSON.stringify(body),
  })
  const result = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result
}

/** Sends your answer; the prompt goes away when the server confirms. */
export async function answer(reply: AskAnswer): Promise<boolean> {
  try {
    await post('/api/answer', reply)
    useToast.getState().show(reply.choice === 'deny' ? 'Denied' : 'Answered')
    return true
  } catch (error) {
    useToast.getState().show(`Couldn’t answer: ${(error as Error).message}`, 'error')
    return false
  }
}

/** Turns answering from AgentHQ on or off (adds or removes its hook in Claude Code's settings). */
export async function setAnswering(enable: boolean): Promise<void> {
  try {
    const result = (await post('/api/answering', { enable })) as { enabled: boolean; backup: string | null }
    useAsks.setState({ enabled: result.enabled })
    useToast
      .getState()
      .show(
        result.enabled
          ? `Answering from AgentHQ is on. New prompts show up here${result.backup ? ` (settings saved to ${result.backup})` : ''}.`
          : 'Answering from AgentHQ is off.',
      )
  } catch (error) {
    useToast.getState().show((error as Error).message, 'error')
  }
}

/** Turns typing into terminals on or off (AgentHQ's own setting; nothing of Claude Code's changes). */
export async function setTyping(enable: boolean): Promise<void> {
  try {
    const result = (await post('/api/typing', { enable })) as { typing: boolean }
    useAsks.setState({ typing: result.typing })
    useToast
      .getState()
      .show(
        result.typing ? 'Typing into terminals is on: message a session from its conversation.' : 'Typing into terminals is off.',
      )
  } catch (error) {
    useToast.getState().show((error as Error).message, 'error')
  }
}

/** Goes to an agent; when it's asking you something, its conversation opens on the question. */
export function goToAgent(sessionId: string, agentId: string): void {
  useOffices.getState().jump(sessionId, agentId)
  if (useAsks.getState().asks.some((ask) => ask.sessionId === sessionId && ask.agentId === agentId)) {
    useChat.getState().show(sessionId, agentId)
  }
}
