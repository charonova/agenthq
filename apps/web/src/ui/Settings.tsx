import { useEffect, useRef, useState } from 'react'
import { setAnswering, setTyping, useAsks } from '../state/asks'
import { chime } from '../state/sound'
import { useOffices, useSettings, useSettingsPanel } from '../state/store'
import { allowNotifications } from '../state/useAlerts'
import { useReducedMotion } from '../state/useMotion'
import type { Motion, Speed, Theme } from '../state/view'

/** ⚙️ Settings: how the office looks and moves, alerts, which offices show, people's looks, and what AgentHQ may do. */
export function SettingsPanel() {
  const open = useSettingsPanel((state) => state.open)
  if (!open) return null
  return <Panel />
}

function Panel() {
  const section = useSettingsPanel((state) => state.section)
  const close = useSettingsPanel((state) => state.close)
  const body = useRef<HTMLDivElement>(null)

  // Opening the settings takes the keyboard there (Esc closes them: useKeyboard).
  useEffect(() => {
    const part = section ? body.current?.querySelector(`#settings-${section}`) : null
    part?.scrollIntoView({ block: 'start' })
    ;(part ?? body.current)?.querySelector<HTMLElement>('button, input')?.focus()
  }, [section])

  return (
    <aside className="settings" role="dialog" aria-label="Settings">
      <header className="settings-head">
        <h3>⚙️ Settings</h3>
        <button className="close" onClick={close} aria-label="Close the settings" title="Close (Esc)">
          ✕
        </button>
      </header>
      <div className="settings-body" ref={body}>
        <LookAndMotion />
        <Alerts />
        <Offices />
        <People />
        <ClaudeCode />
      </div>
    </aside>
  )
}

/** A row of choices, one picked. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="choice">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} role="radio" aria-checked={value === option} onClick={() => onChange(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  )
}

function LookAndMotion() {
  const { theme, speed, motion, set } = useSettings()
  const reduced = useReducedMotion((state) => state.reduced)
  return (
    <section id="settings-office">
      <h4>The office</h4>
      <Choice<Theme>
        label="Day and night"
        value={theme}
        options={[
          ['clock', 'Follow the clock'],
          ['day', 'Always day'],
          ['night', 'Always night'],
        ]}
        onChange={(theme) => set({ theme })}
      />
      <Choice<Speed>
        label="Animation speed"
        value={speed}
        options={[
          ['slow', 'Slow'],
          ['normal', 'Normal'],
          ['fast', 'Fast'],
        ]}
        onChange={(speed) => set({ speed })}
      />
      <Choice<Motion>
        label="Motion"
        value={motion}
        options={[
          ['system', 'Like my computer'],
          ['full', 'Full'],
          ['reduced', 'Reduced'],
        ]}
        onChange={(motion) => set({ motion })}
      />
      <small className="note">
        {reduced
          ? 'Reduced now: people step straight to where they go, nothing blinks, and the camera cuts instead of gliding.'
          : 'Full motion now. “Like my computer” follows its “reduce motion” setting.'}
      </small>
    </section>
  )
}

function Alerts() {
  const { notify, sound, finished, set } = useSettings()
  const [blocked, setBlocked] = useState(false)
  const toggleNotify = async () => {
    if (notify) return set({ notify: false })
    const allowed = await allowNotifications()
    setBlocked(!allowed)
    set({ notify: allowed })
  }
  return (
    <section id="settings-alerts">
      <h4>Alerts</h4>
      <Check checked={notify} onChange={() => void toggleNotify()}>
        Notify me when an agent needs me
        {blocked && <small>Notifications are blocked for this page in your browser’s settings.</small>}
      </Check>
      <Check checked={sound} onChange={() => set({ sound: !sound })}>
        Play a sound
      </Check>
      <Check checked={finished} onChange={() => set({ finished: !finished })}>
        Also when a session finishes
      </Check>
      <button className="btn test" onClick={() => chime('waiting')}>
        ▶ Test sound
      </button>
    </section>
  )
}

function Offices() {
  const { hidden, hideEnded, hideCodex, set } = useSettings()
  const all = useOffices((state) => state.allOffices)
  const toggle = (id: string) => set({ hidden: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id] })
  // Hidden offices that closed since are forgotten when you show everything.
  return (
    <section id="settings-offices">
      <h4>Offices</h4>
      <Check checked={hideEnded} onChange={() => set({ hideEnded: !hideEnded })}>
        Hide sessions that ended
      </Check>
      <Check checked={hideCodex} onChange={() => set({ hideCodex: !hideCodex })}>
        Hide Codex sessions
      </Check>
      {all.length > 0 && (
        <div className="office-list">
          {all.map((office) => (
            <Check key={office.sessionId} checked={!hidden.includes(office.sessionId)} onChange={() => toggle(office.sessionId)}>
              {office.project}
              <small>{office.title ?? 'Untitled session'}</small>
            </Check>
          ))}
        </div>
      )}
      {hidden.length > 0 && (
        <button className="btn" onClick={() => set({ hidden: [] })}>
          Show every office
        </button>
      )}
    </section>
  )
}

function People() {
  const { looks, set } = useSettings()
  const chosen = Object.keys(looks)
  const forget = (key: string) => {
    const next = { ...looks }
    delete next[key]
    set({ looks: next })
  }
  return (
    <section id="settings-people">
      <h4>People</h4>
      <small className="note">Pick someone’s look from their details: 🎨 Look. Teammates keep it in every session.</small>
      {chosen.length > 0 && (
        <ul className="looks">
          {chosen.map((key) => (
            <li key={key}>
              <span>{key.replace(/^(\w+):/, (_, role: string) => `${role} · `)}</span>
              <button className="btn" onClick={() => forget(key)}>
                Reset
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ClaudeCode() {
  return (
    <section id="settings-claude">
      <h4>Claude Code</h4>
      <Answering />
      <Typing />
    </section>
  )
}

function Answering() {
  const enabled = useAsks((state) => state.enabled)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="switch-box answering">
      <p>
        <b>Answer from AgentHQ</b> {enabled ? <span className="on">On</span> : <span>Off</span>}
      </p>
      {enabled ? (
        <>
          <small>
            Permission prompts and questions from Claude Code show up in the conversation. The terminal can still answer.
          </small>
          <button className="btn" onClick={() => void setAnswering(false)}>
            Turn off (removes the hook)
          </button>
        </>
      ) : confirming ? (
        <>
          <small>
            This adds one hook to <code>~/.claude/settings.json</code> (a copy is saved first). It hands Claude Code’s permission
            prompts and questions to AgentHQ, and does nothing while AgentHQ is closed. Your other hooks stay as they are.
          </small>
          <div className="row-buttons">
            <button
              className="btn primary"
              onClick={() => {
                setConfirming(false)
                void setAnswering(true)
              }}
            >
              Turn on
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <small>Answer permission prompts and questions here, without going to the terminal.</small>
          <button className="btn" onClick={() => setConfirming(true)}>
            Turn on…
          </button>
        </>
      )}
    </div>
  )
}

function Typing() {
  const typing = useAsks((state) => state.typing)
  const canType = useAsks((state) => state.canType)
  const [confirming, setConfirming] = useState(false)
  if (!canType) return null
  return (
    <div className="switch-box typing">
      <p>
        <b>Type into terminals</b> {typing ? <span className="on">On</span> : <span>Off</span>}
      </p>
      {typing ? (
        <>
          <small>
            Messages you write in a terminal session’s conversation are typed into its Terminal or iTerm2 tab, then Enter.
          </small>
          <button className="btn" onClick={() => void setTyping(false)}>
            Turn off
          </button>
        </>
      ) : confirming ? (
        <>
          <small>
            What you send from a session’s conversation is typed into its own Terminal or iTerm2 tab, exactly as if you typed it
            there, then Enter (macOS asks once to let AgentHQ control the app). Line breaks become spaces. Nothing is typed
            anywhere else; Claude Code’s settings don’t change.
          </small>
          <div className="row-buttons">
            <button
              className="btn primary"
              onClick={() => {
                setConfirming(false)
                void setTyping(true)
              }}
            >
              Turn on
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <small>Message sessions running in Terminal or iTerm2 from here (macOS).</small>
          <button className="btn" onClick={() => setConfirming(true)}>
            Turn on…
          </button>
        </>
      )}
    </div>
  )
}
