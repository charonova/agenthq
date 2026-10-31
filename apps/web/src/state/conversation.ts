import type { ConversationPage, Message, ToolResult } from '@agenthq/core'
import { create } from 'zustand'

/** The conversation open beside the office, if any. */
interface ChatState {
  open: { sessionId: string; agentId: string } | null
  show: (sessionId: string, agentId: string) => void
  close: () => void
}

export const useChat = create<ChatState>()((set) => ({
  open: null,
  show: (sessionId, agentId) => set({ open: { sessionId, agentId } }),
  close: () => set({ open: null }),
}))

/** What's loaded of a conversation: a window of its transcript, from `start` to `end` bytes. */
export interface Loaded {
  messages: Message[]
  start: number
  end: number
  /** Results that came before their call was loaded (an older page), by call. */
  orphans: Record<string, ToolResult>
}

export const emptyLoaded: Loaded = { messages: [], start: 0, end: 0, orphans: {} }

/**
 * Adds a page to what's loaded: newer pages go after, older ones before. Results come apart from
 * their calls at page edges; they're put back on their call, wherever it is.
 */
export function addPage(loaded: Loaded, page: ConversationPage, where: 'newer' | 'older'): Loaded {
  const orphans = { ...loaded.orphans }
  const incoming: Message[] = []
  for (const message of page.messages) {
    if (message.kind === 'result') orphans[message.toolId] = message.result
    else incoming.push(message)
  }
  const known = new Set(loaded.messages.map((message) => message.id))
  const fresh = incoming.filter((message) => !known.has(message.id))
  const messages = (where === 'newer' ? [...loaded.messages, ...fresh] : [...fresh, ...loaded.messages]).map((message) => {
    if (message.kind !== 'tool' || message.result || !orphans[message.id]) return message
    const result = orphans[message.id]!
    delete orphans[message.id]
    return { ...message, result }
  })
  return {
    messages,
    start: where === 'older' || loaded.messages.length === 0 ? page.start : loaded.start,
    end: where === 'newer' || loaded.messages.length === 0 ? Math.max(page.end, loaded.end) : loaded.end,
    orphans,
  }
}

/** A page of an agent's conversation from the server. */
export async function fetchPage(
  sessionId: string,
  agentId: string,
  page: { before?: number; since?: number } = {},
  signal?: AbortSignal,
): Promise<ConversationPage> {
  const query = new URLSearchParams({ session: sessionId, agent: agentId })
  if (page.before !== undefined) query.set('before', String(page.before))
  if (page.since !== undefined) query.set('since', String(page.since))
  const response = await fetch(`/api/conversation?${query}`, { headers: { 'X-AgentHQ': '1' }, signal })
  if (!response.ok)
    throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? response.statusText)
  return (await response.json()) as ConversationPage
}

/** Whether a message mentions what's searched for, in any of its text. */
export function matches(message: Message, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const texts: (string | null | undefined)[] =
    message.kind === 'tool'
      ? [message.tool.name, message.tool.target, message.input, message.result?.text]
      : message.kind === 'agent'
        ? [message.from, message.summary, message.text]
        : message.kind === 'result'
          ? [message.result.text]
          : [message.text]
  return texts.some((text) => text?.toLowerCase().includes(needle))
}
