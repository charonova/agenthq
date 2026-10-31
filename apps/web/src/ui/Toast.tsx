import { useToast } from '../state/jump'

/** One short message at the bottom of the office, gone after a few seconds. */
export function Toast() {
  const toast = useToast((state) => state.toast)
  if (!toast) return null
  return (
    <div key={toast.id} className={`toast ${toast.tone}`} role="status">
      {toast.text}
    </div>
  )
}
