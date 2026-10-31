import { useEffect, useMemo, useState } from 'react'
import { recentFolders, startSession, useSessions, type Mode, type Model } from '../state/sessions'
import { useOffices } from '../state/store'

/** Starting a Claude Code session from AgentHQ: a folder, a first message, and how it may work. */
export function NewSession() {
  const composing = useSessions((state) => state.composing)
  if (!composing) return null
  return <Dialog />
}

function Dialog() {
  const compose = useSessions((state) => state.compose)
  const offices = useOffices((state) => state.offices)
  const folders = useMemo(
    () => [...new Set([...recentFolders(), ...offices.flatMap((office) => (office.cwd ? [office.cwd] : []))])],
    [offices],
  )
  const [cwd, setCwd] = useState(folders[0] ?? '')
  const [text, setText] = useState('')
  const [model, setModel] = useState<Model>('')
  const [mode, setMode] = useState<Mode>('default')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') compose(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compose])

  const submit = async () => {
    if (!cwd.trim() || !text.trim() || busy) return
    setBusy(true)
    if (!(await startSession({ cwd, text, model, mode }))) setBusy(false)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && compose(false)}>
      <form
        className="dialog"
        role="dialog"
        aria-label="New session"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>New Claude Code session</h2>
        <label>
          <span>Folder</span>
          <input
            list="agenthq-folders"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="/path/to/your/project"
            spellCheck={false}
            autoFocus={!cwd}
          />
          <datalist id="agenthq-folders">
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Message</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What should it do?"
            rows={5}
            autoFocus={!!cwd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            }}
          />
        </label>
        <div className="dialog-row">
          <label>
            <span>Model</span>
            <select value={model} onChange={(event) => setModel(event.target.value as Model)}>
              <option value="">Your default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>
          <label>
            <span>Permissions</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
              <option value="default">Ask me</option>
              <option value="acceptEdits">Accept edits</option>
              <option value="plan">Plan only</option>
              <option value="auto">Auto</option>
            </select>
          </label>
        </div>
        <p className="dialog-note">
          Runs your Claude Code in that folder, with your account and settings. Its prompts show up in its conversation here; it
          keeps running while AgentHQ is open.
        </p>
        <div className="row-buttons end">
          <button type="button" className="btn" onClick={() => compose(false)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!cwd.trim() || !text.trim() || busy}>
            {busy ? 'Starting…' : 'Start'}
          </button>
        </div>
      </form>
    </div>
  )
}
