import { play, speeds, stopReplay, useReplay } from '../state/replay'
import { useOffices } from '../state/store'

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** The replay's controls, under the office: play or pause, how fast, and the moment shown. */
export function ReplayBar() {
  const { data, t, playing, speed } = useReplay()
  const project = useOffices((state) => state.allOffices.find((office) => office.sessionId === data?.sessionId)?.project)
  if (!data) return null
  const steps = data.agents.reduce((n, agent) => n + agent.steps.length, 0)
  return (
    <div className="replay-bar" role="region" aria-label="Replay">
      <span className="replay-what">
        ⏪ <b>{project ?? 'Replay'}</b> · {steps} steps
      </span>
      <button
        className="btn"
        onClick={() => {
          useReplay.setState({ playing: !playing, t: !playing && t >= data.to ? data.from : t })
          play()
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={data.from}
        max={data.to}
        step={1000}
        value={t}
        onChange={(event) => useReplay.setState({ t: Number(event.target.value), playing: false })}
        aria-label="Moment shown"
      />
      <time>{clock(t)}</time>
      <select value={speed} onChange={(event) => useReplay.setState({ speed: Number(event.target.value) })} aria-label="Speed">
        {speeds.map((value) => (
          <option key={value} value={value}>
            {value / 60} min/s
          </option>
        ))}
      </select>
      <button className="btn primary" onClick={stopReplay}>
        Back to live
      </button>
    </div>
  )
}
