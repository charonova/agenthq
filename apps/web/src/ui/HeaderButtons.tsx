import { useSettings, useSettingsPanel } from '../state/store'

/** The bell in the header: shows whether alerts are on, and opens their settings. */
export function Bell() {
  const { notify, sound } = useSettings()
  const open = useSettingsPanel((state) => state.open)
  const on = notify || sound
  return (
    <button
      className={`bell${on ? ' on' : ''}`}
      onClick={() => (open ? useSettingsPanel.getState().close() : useSettingsPanel.getState().show('alerts'))}
      aria-expanded={open}
      title={on ? 'Alerts are on' : 'Alerts are off'}
      aria-label="Alerts"
    >
      {on ? '🔔' : '🔕'}
    </button>
  )
}

/** ⚙️ in the header: opens the settings. */
export function Gear() {
  const open = useSettingsPanel((state) => state.open)
  return (
    <button
      className="gear"
      onClick={() => (open ? useSettingsPanel.getState().close() : useSettingsPanel.getState().show())}
      aria-expanded={open}
      title="Settings"
      aria-label="Settings"
    >
      ⚙️
    </button>
  )
}
