import type { Ask, AskAnswer } from '@agenthq/core'
import { create } from 'zustand'
import { useChat } from './conversation'
import { useToast } from './jump'
import { useOffices } from './store'

/** Prompts waiting on you, and whether answering from AgentHQ is on (its hook is installed). */
interface AsksState {
  enabled: boolean
  asks: Ask[]
  receive: (data: { enabled: boolean; asks: Ask[] }) => void
}

export const useAsks = create<AsksState>()((set) => ({
  enabled: false,
  asks: [],
  receive: ({ enabled, asks }) => set({ enabled, asks }),
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

/** Goes to an agent; when it's asking you something, its conversation opens on the question. */
export function goToAgent(sessionId: string, agentId: string): void {
  useOffices.getState().jump(sessionId, agentId)
  if (useAsks.getState().asks.some((ask) => ask.sessionId === sessionId && ask.agentId === agentId)) {
    useChat.getState().show(sessionId, agentId)
  }
}
