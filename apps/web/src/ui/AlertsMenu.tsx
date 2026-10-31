import { useEffect, useRef, useState } from 'react'
import { chime } from '../state/sound'
import { setAnswering, useAsks } from '../state/asks'
import { useSettings } from '../state/store'
import { allowNotifications } from '../state/useAlerts'

/** The bell in the header: notifications, sound, and whether finished sessions ring too. */
export function AlertsMenu() {
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const { notify, sound, finished, set } = useSettings()
  const enabled = useAsks((state) => state.enabled)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const toggleNotify = async () => {
    if (notify) return set({ notify: false })
    const allowed = await allowNotifications()
    setBlocked(!allowed)
    set({ notify: allowed })
  }

  return (
    <div className="alerts" ref={menu}>
      <button
        className={`bell${notify || sound ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Alerts"
      >
        {notify || sound ? '🔔' : '🔕'}
      </button>
      {open && (
        <div className="menu" role="menu">
          <label>
            <input type="checkbox" checked={notify} onChange={toggleNotify} />
            <span>
              Notify me when an agent needs me
              {blocked && <small>Notifications are blocked for this page in your browser’s settings.</small>}
            </span>
          </label>
          <label>
            <input type="checkbox" checked={sound} onChange={() => set({ sound: !sound })} />
            <span>Play a sound</span>
          </label>
          <label>
            <input type="checkbox" checked={finished} onChange={() => set({ finished: !finished })} />
            <span>Also when a session finishes</span>
          </label>
          <button className="test" onClick={() => chime('waiting')}>
            ▶ Test sound
          </button>
          <div className="answering">
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
                  This adds one hook to <code>~/.claude/settings.json</code> (a copy is saved first). It hands Claude Code’s
                  permission prompts and questions to AgentHQ, and does nothing while AgentHQ is closed. Your other hooks stay as
                  they are.
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
        </div>
      )}
    </div>
  )
}
