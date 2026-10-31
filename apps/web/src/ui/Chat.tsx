import type { Agent, ConversationPage, Message, Office } from '@agenthq/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { activityIcon, stateEmoji } from '../scene/plan'
import { useAsks } from '../state/asks'
import { addPage, emptyLoaded, fetchPage, landed, matches, useChat, type Loaded } from '../state/conversation'
import { goToSession } from '../state/jump'
import { useDrafts } from '../state/sessions'
import { everyone, useOffices } from '../state/store'
import { AskCard } from './AskCard'
import { Composer } from './Composer'
import { Markdown } from './Markdown'

/** The open conversation, over the office. It closes when its agent leaves. */
export function ChatPanel() {
  const open = useChat((state) => state.open)
  const office = useOffices((state) => (open ? state.offices.find((o) => o.sessionId === open.sessionId) : undefined))
  const agent = office && open ? everyone(office).find((a) => a.id === open.agentId) : undefined
  if (!open || !office || !agent) return null
  return <Chat key={`${office.sessionId}/${agent.id}`} office={office} agent={agent} />
}

const nameOf = (agent: Agent, office: Office) =>
  agent.role === 'manager'
    ? office.kind === 'codex'
      ? 'Codex'
      : 'Manager'
    : agent.role === 'intern'
      ? (agent.task ?? agent.name)
      : agent.name

function Chat({ office, agent }: { office: Office; agent: Agent }) {
  const close = useChat((state) => state.close)
  const [loaded, setLoaded] = useState<Loaded>(emptyLoaded)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [olderLoading, setOlderLoading] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef(loaded)
  useLayoutEffect(() => {
    latest.current = loaded
  }, [loaded])
  /** Following the newest messages, unless you scrolled up to read. */
  const following = useRef(true)
  /** Set before older messages go in on top, so what you're reading stays put. */
  const anchor = useRef<number | null>(null)
  const fetching = useRef(false)
  const again = useRef(false)
  const loadingOlder = useRef(false)
  // The reply a session AgentHQ runs is writing, until its transcript line lands.
  const rawDraft = useDrafts((state) => (agent.role === 'manager' ? state.drafts[office.sessionId] : undefined))
  const draft = rawDraft && rawDraft.text.trim() && !landed(rawDraft, loaded.messages) ? rawDraft : null

  useEffect(() => {
    const controller = new AbortController()
    fetchPage(office.sessionId, agent.id, {}, controller.signal)
      .then((page) => {
        setLoaded(addPage(emptyLoaded, page, 'newer'))
        setStatus('ready')
      })
      .catch((reason: Error) => {
        if (controller.signal.aborted) return
        setError(reason.message)
        setStatus('error')
      })
    return () => controller.abort()
  }, [office.sessionId, agent.id])

  // New lines in its transcript: fetch what came since (one request at a time).
  const catchUp = useCallback(async () => {
    if (fetching.current) {
      again.current = true
      return
    }
    fetching.current = true
    try {
      do {
        again.current = false
        const page = await fetchPage(office.sessionId, agent.id, { since: latest.current.end })
        if (page.messages.length || page.end !== latest.current.end) setLoaded((current) => addPage(current, page, 'newer'))
      } while (again.current)
    } catch {
      // The next change tries again.
    } finally {
      fetching.current = false
    }
  }, [office.sessionId, agent.id])

  useEffect(() => {
    if (status === 'ready') void catchUp()
  }, [agent.updatedAt, status, catchUp])

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || latest.current.start === 0) return
    loadingOlder.current = true
    setOlderLoading(true)
    try {
      // Some stretches hold nothing to show (progress lines, attachments): keep going a little.
      const pages: ConversationPage[] = []
      let start = latest.current.start
      for (let tries = 0; tries < 8 && start > 0; tries++) {
        const page = await fetchPage(office.sessionId, agent.id, { before: start })
        pages.push(page)
        start = page.start
        if (page.messages.some((message) => message.kind !== 'result')) break
      }
      anchor.current = list.current ? list.current.scrollHeight - list.current.scrollTop : null
      setLoaded((current) => pages.reduce<Loaded>((loaded, page) => addPage(loaded, page, 'older'), current))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      loadingOlder.current = false
      setOlderLoading(false)
    }
  }, [office.sessionId, agent.id])

  // A page of mostly tool output or attachments shows little: fill the view from earlier pages.
  const shownCount = loaded.messages.filter((message) => message.kind !== 'result').length
  useEffect(() => {
    if (status !== 'ready' || query || loaded.start === 0 || shownCount >= 20) return
    const timer = setTimeout(() => void loadOlder(), 0)
    return () => clearTimeout(timer)
  }, [status, query, loaded.start, shownCount, loadOlder])

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    if (anchor.current !== null) {
      element.scrollTop = element.scrollHeight - anchor.current
      anchor.current = null
    } else if (following.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [loaded, query, draft?.text])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const onScroll = () => {
    const element = list.current!
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    if (element.scrollTop < 80 && status === 'ready' && !query) void loadOlder()
  }

  const allAsks = useAsks((state) => state.asks)
  const asks = allAsks.filter((ask) => ask.sessionId === office.sessionId && ask.agentId === agent.id)
  const shown = query ? loaded.messages.filter((message) => matches(message, query)) : loaded.messages
  const name = nameOf(agent, office)

  return (
    <section className="chat" aria-label={`Conversation with ${name}`}>
      <header className="chat-head">
        <span className="emoji">{stateEmoji(agent)}</span>
        <div className="title">
          <h3>{name}</h3>
          <p>
            {agent.role} · {office.project}
            {office.kind === 'codex' ? ' · Codex' : ''}
          </p>
        </div>
        <button className="go" onClick={() => void goToSession(office.sessionId)} title="Answer it in its terminal or editor">
          Go to session ↗
        </button>
        <button className="close" onClick={close} aria-label="Close the conversation" title="Close (Esc)">
          ✕
        </button>
      </header>
      <div className="chat-search">
        <input
          type="search"
          placeholder="Search this conversation"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search this conversation"
        />
        {query && (
          <span className="found">
            {shown.length} of {loaded.messages.length}
          </span>
        )}
      </div>
      <div className="chat-list" ref={list} onScroll={onScroll}>
        {status === 'loading' && <p className="chat-note">Reading the conversation…</p>}
        {status === 'error' && <p className="chat-note error">Couldn’t read it: {error}</p>}
        {status === 'ready' && loaded.start > 0 && (
          <button className="older" onClick={() => void loadOlder()} disabled={olderLoading}>
            {olderLoading ? 'Loading…' : query ? 'Search earlier messages too' : 'Load earlier messages'}
          </button>
        )}
        {status === 'ready' && loaded.start === 0 && <p className="chat-note">The beginning of the conversation</p>}
        {shown.map((message) => (
          <MessageView key={message.id} message={message} name={name} />
        ))}
        {draft && !query && (
          <div className={`msg assistant draft${draft.final ? '' : ' writing'}`} aria-live="polite">
            <Meta who={name} at={null} extra={draft.final ? null : 'writing…'} />
            <div className="bubble">
              <Markdown text={draft.text} />
            </div>
          </div>
        )}
        {status === 'ready' && shown.length === 0 && !draft && (
          <p className="chat-note">{query ? 'Nothing found in what’s loaded.' : 'Nothing said yet.'}</p>
        )}
      </div>
      {asks.length > 0 && (
        <div className="asks">
          {asks.map((ask) => (
            <AskCard key={ask.id} ask={ask} />
          ))}
        </div>
      )}
      <Composer office={office} isManager={agent.role === 'manager'} />
    </section>
  )
}

function MessageView({ message, name }: { message: Message; name: string }) {
  switch (message.kind) {
    case 'user':
      return (
        <div className="msg user">
          <Meta who="You" at={message.at} />
          <div className="bubble">
            <Markdown text={message.text} />
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="msg assistant">
          <Meta who={name} at={message.at} />
          <div className="bubble">
            <Markdown text={message.text} />
          </div>
        </div>
      )
    case 'agent':
      return (
        <div className="msg agent" style={{ ['--who' as string]: colorOf(message.color) }}>
          <Meta who={`From ${message.from}`} at={message.at} extra={message.summary} />
          <div className="bubble">
            <Markdown text={message.text} />
          </div>
        </div>
      )
    case 'tool':
      return (
        <details className={`tool${message.result?.isError ? ' failed' : ''}`}>
          <summary>
            <span className="icon">{activityIcon[message.tool.activity]}</span>
            <b>{message.tool.name}</b>
            <span className="target">{message.tool.target}</span>
            <span className="state">{message.result ? (message.result.isError ? 'failed' : '') : '…'}</span>
          </summary>
          {message.input && <pre className="input">{message.input}</pre>}
          {message.result && <pre className="output">{message.result.text || '(no output)'}</pre>}
        </details>
      )
    case 'notice':
      return <p className="notice">{message.text}</p>
    case 'result':
      return null
  }
}

function Meta({ who, at, extra }: { who: string; at: number | null; extra?: string | null }) {
  return (
    <div className="meta">
      <b>{who}</b>
      {extra && <span>{extra}</span>}
      {at !== null && <time>{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
    </div>
  )
}

/** Teammates' colors as Claude Code names them. */
const colors: Record<string, string> = {
  red: '#ff7b72',
  orange: '#ffa657',
  yellow: '#ffd479',
  green: '#4cd97b',
  blue: '#79b8ff',
  purple: '#c792ea',
  pink: '#ff8fc7',
  cyan: '#76e4f7',
}
const colorOf = (color: string | null) => (color && colors[color]) ?? '#9aa0b2'
