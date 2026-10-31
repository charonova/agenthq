import type { Agent, Office } from '@agenthq/core'
import { activityIcon, agoText, describe, stateEmoji } from '../scene/plan'
import { useAsks } from '../state/asks'
import { useChat } from '../state/conversation'
import { goToSession } from '../state/jump'
import { everyone, useOffices } from '../state/store'
import { LookEditor } from './LookEditor'
import { useNow } from './useNow'
import { focusSoon } from '../state/useKeyboard'
import { useState } from 'react'

export function SidePanel() {
  const offices = useOffices((state) => state.offices)
  const focusedId = useOffices((state) => state.focusedId)
  const office = offices.find((o) => o.sessionId === focusedId)
  return <aside className="side">{office ? <OfficePanel office={office} /> : <BuildingPanel offices={offices} />}</aside>
}

function BuildingPanel({ offices }: { offices: Office[] }) {
  const focus = useOffices((state) => state.focus)
  return (
    <>
      <h3>Offices</h3>
      <div className="list">
        {offices.map((office) => {
          const agents = everyone(office)
          const working = agents.filter((a) => a.state === 'working').length
          const waiting = agents.filter((a) => a.state === 'waiting').length
          return (
            <button
              key={office.sessionId}
              className="row office-row"
              data-session={office.sessionId}
              onClick={() => {
                focus(office.sessionId)
                // The keyboard follows into the office: Tab goes through its people.
                focusSoon('.side .person')
              }}
            >
              <span className={`light ${office.ended ? 'ended' : waiting ? 'waiting' : working ? 'busy' : ''}`} />
              <span className="text">
                <span className="who">
                  {office.project}
                  {office.kind === 'codex' && <small>codex</small>}
                  {office.managed && <small className="here">runs here</small>}
                  {office.ended && <small>ended</small>}
                </span>
                <span className="what">{office.title ?? 'Untitled session'}</span>
              </span>
              <span className="counts">
                <span>👥 {agents.filter((a) => a.state !== 'gone').length}</span>
                <span>⌨️ {working}</span>
                {waiting > 0 && <span>✋ {waiting}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <p className="hint">
        Click an office to go inside, double-click someone to go to their session. Drag to move around, scroll to zoom.
      </p>
    </>
  )
}

function OfficePanel({ office }: { office: Office }) {
  const focus = useOffices((state) => state.focus)
  const selectedId = useOffices((state) => state.selectedAgentId)
  const select = useOffices((state) => state.select)
  const now = useNow()
  const selected = everyone(office).find((agent) => agent.id === selectedId)
  const internsOf = (id: string) => office.interns.filter((intern) => intern.parentId === id)
  const row = (agent: Agent, role: string) => (
    <button
      key={agent.id}
      data-agent={agent.id}
      aria-pressed={agent.id === selectedId}
      className={`row person${agent.role === 'intern' ? ' intern' : ''}${agent.id === selectedId ? ' selected' : ''}`}
      onClick={() => select(agent.id === selectedId ? null : agent.id)}
    >
      <span className="emoji">{stateEmoji(agent)}</span>
      <span className="text">
        <span className="who">
          {agent.role === 'intern' ? (agent.task ?? agent.name) : agent.role === 'manager' ? 'Manager' : agent.name}
          <small>{role}</small>
        </span>
        <span className="what">{describe(agent, now)}</span>
      </span>
    </button>
  )
  return (
    <>
      <div className="office-head">
        <button
          className="back"
          onClick={() => {
            focus(null)
            focusSoon(`.office-row[data-session="${CSS.escape(office.sessionId)}"]`)
          }}
        >
          ← Building
        </button>
        <h2>{office.project}</h2>
        <p>{[office.title, office.cwd].filter(Boolean).join(' · ')}</p>
      </div>
      <h3>
        {everyone(office).filter((a) => a.state !== 'gone').length} in the office · {office.wentHome} went home
      </h3>
      <div className="list">
        {row(office.manager, 'manager')}
        {internsOf(office.sessionId).map((intern) => row(intern, 'intern'))}
        {office.staff.map((member) => [row(member, 'staff'), ...internsOf(member.id).map((intern) => row(intern, 'intern'))])}
      </div>
      {selected && (
        <Details
          key={selected.id}
          agent={selected}
          office={office}
          sessionId={office.sessionId}
          status={office.ended ? 'ended' : office.process?.status}
          now={now}
        />
      )}
    </>
  )
}

function Details({
  agent,
  office,
  sessionId,
  status,
  now,
}: {
  agent: Agent
  office: Office
  sessionId: string
  status?: string | null
  now: number
}) {
  const showChat = useChat((state) => state.show)
  const [styling, setStyling] = useState(false)
  const asked = useAsks((state) => state.asks.filter((ask) => ask.sessionId === sessionId && ask.agentId === agent.id).length)
  const items: [string, string | null][] = [
    ['Doing', describe(agent, now)],
    ['Task', agent.task],
    ['Tool', agent.tool ? `${agent.tool.name}${agent.tool.target ? ` · ${agent.tool.target}` : ''}` : null],
    ['Model', agent.model],
    ['Context', agent.contextTokens ? `${Math.round(agent.contextTokens / 1000)}k tokens` : null],
    ['Last seen', agoText(agent.updatedAt, now)],
    ['Claude Code', agent.role === 'manager' ? (status ?? null) : null],
  ]
  return (
    <div className="details">
      <div className="details-head">
        <h4>
          {stateEmoji(agent)} {agent.role === 'manager' ? 'Manager' : agent.name}
        </h4>
        <button className="go chat-open" onClick={() => showChat(sessionId, agent.id)} title="Read its whole conversation">
          💬 Conversation
        </button>
        <button className="go look" onClick={() => setStyling(!styling)} aria-expanded={styling} title="Choose how they look">
          🎨
        </button>
        <button
          className="go jump"
          onClick={() => void goToSession(sessionId)}
          title="Bring its terminal or editor window forward (or double-click them)"
        >
          Go to ↗
        </button>
      </div>
      {styling && <LookEditor agent={agent} office={office} />}
      {asked > 0 && (
        <button className="asked" onClick={() => showChat(sessionId, agent.id)}>
          ✋ {asked === 1 ? 'It asks you something' : `It asks you ${asked} things`} · <b>Answer</b>
        </button>
      )}
      <dl>
        {items
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {agent.lastText && <p className="said">“{agent.lastText}”</p>}
      {agent.history.length > 0 && (
        <ol className="timeline">
          {[...agent.history].reverse().map((step) => (
            <li key={`${step.at}-${step.tool.name}`}>
              <time>{clock(step.at)}</time>
              <span>
                {activityIcon[step.tool.activity]} {step.tool.target ?? step.tool.name}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
