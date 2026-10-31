import { totals, useOffices } from '../state/store'

const connectionText = { connecting: 'Connecting…', live: 'Live', offline: 'Reconnecting…' } as const

export function Header() {
  const offices = useOffices((state) => state.offices)
  const connection = useOffices((state) => state.connection)
  const focus = useOffices((state) => state.focus)
  const t = totals(offices)
  return (
    <header className="bar">
      <button className="brand" onClick={() => focus(null)}>
        🏢 AgentHQ
      </button>
      <div className="stats">
        <Chip icon="🏢" value={t.offices} label={t.offices === 1 ? 'office' : 'offices'} />
        <Chip icon="⌨️" value={t.working} label="working" />
        <Chip icon="✋" value={t.waiting} label="need you" highlight={t.waiting > 0} />
        <Chip icon="☕" value={t.resting} label="on a break" />
      </div>
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
