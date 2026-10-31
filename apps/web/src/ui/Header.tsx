import { useRef } from 'react'
import { everyone, totals, useOffices } from '../state/store'
import { AlertsMenu } from './AlertsMenu'

const connectionText = { connecting: 'Connecting…', live: 'Live', offline: 'Reconnecting…' } as const

export function Header() {
  const offices = useOffices((state) => state.offices)
  const connection = useOffices((state) => state.connection)
  const focus = useOffices((state) => state.focus)
  const t = totals(offices)
  const next = useRef(0)
  /** Goes to the agents waiting for you, one after another. */
  const showWaiting = () => {
    const waiting = offices.flatMap((office) =>
      everyone(office)
        .filter((agent) => agent.state === 'waiting')
        .map((agent) => [office.sessionId, agent.id] as const),
    )
    if (waiting.length === 0) return
    const [officeId, agentId] = waiting[next.current++ % waiting.length]!
    useOffices.getState().jump(officeId, agentId)
  }
  return (
    <header className="bar">
      <button className="brand" onClick={() => focus(null)}>
        🏢 AgentHQ
      </button>
      <div className="stats">
        <Chip icon="🏢" value={t.offices} label={t.offices === 1 ? 'office' : 'offices'} />
        <Chip icon="⌨️" value={t.working} label="working" />
        <button className="chip-button" onClick={showWaiting} disabled={t.waiting === 0} title="Go to who needs you">
          <Chip icon="✋" value={t.waiting} label="need you" highlight={t.waiting > 0} />
        </button>
        <Chip icon="☕" value={t.resting} label="on a break" />
      </div>
      <AlertsMenu />
      <div className={`live ${connection}`}>
        <span className="dot" />
        {connectionText[connection]}
      </div>
    </header>
  )
}

function Chip({ icon, value, label, highlight }: { icon: string; value: number; label: string; highlight?: boolean }) {
  return (
    <span className={`chip${highlight ? ' highlight' : ''}`}>
      {icon} <b>{value}</b> {label}
    </span>
  )
}
