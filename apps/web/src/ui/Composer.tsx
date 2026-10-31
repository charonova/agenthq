import type { Office } from '@agenthq/core'
import { useState } from 'react'
import { useAsks } from '../state/asks'
import { endSession, interrupt, sendMessage } from '../state/sessions'

/**
 * Talking to a session from its conversation: one AgentHQ runs takes messages (and can be
 * interrupted); one that ended can be resumed here; one running in a terminal is answered there.
 */
export function Composer({ office, isManager }: { office: Office; isManager: boolean }) {
  const enabled = useAsks((state) => state.enabled)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const managed = office.managed
  const canSend = office.kind === 'claude' && isManager && (managed || office.ended)

  if (!canSend) {
    return (
      <footer className="chat-foot">
        {office.kind === 'codex'
          ? 'Answer Codex in its session (“Go to session”).'
          : !isManager
            ? 'Messages go to the manager: open its conversation to write one.'
            : `It runs in a terminal: message it there (“Go to session”).${enabled ? ' Its prompts show up here.' : ''}`}
      </footer>
    )
  }

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    if (await sendMessage(office.sessionId, text)) setText('')
    setSending(false)
  }

  return (
    <footer className="composer">
      {managed?.error && <p className="composer-error">{managed.error}</p>}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          }
        }}
        placeholder={
          managed
            ? managed.busy
              ? 'It’s working: your message goes in after this step'
              : 'Message it'
            : 'Message it to resume this session here'
        }
        rows={2}
        aria-label="Your message"
      />
      <div className="composer-actions">
        <span className="composer-state">
          {managed ? (managed.busy ? '⌨️ Working…' : 'Runs here · Enter to send') : 'Ended · sending resumes it here'}
        </span>
        {managed?.busy && (
          <button className="btn" onClick={() => void interrupt(office.sessionId)}>
            Interrupt
          </button>
        )}
        {managed && (
          <button
            className="btn"
            onClick={() => void endSession(office.sessionId)}
            title="Stop its process; send a message later to resume"
          >
            End
          </button>
        )}
        <button className="btn primary" disabled={!text.trim() || sending} onClick={() => void send()}>
          {managed ? 'Send' : 'Resume here'}
        </button>
      </div>
    </footer>
  )
}
