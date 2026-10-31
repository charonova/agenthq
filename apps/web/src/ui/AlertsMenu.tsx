import { useEffect, useRef, useState } from 'react'
import { chime } from '../state/sound'
import { useSettings } from '../state/store'
import { allowNotifications } from '../state/useAlerts'

/** The bell in the header: notifications, sound, and whether finished sessions ring too. */
export function AlertsMenu() {
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const { notify, sound, finished, set } = useSettings()

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
        </div>
      )}
    </div>
  )
}
