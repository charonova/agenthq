import type { Ask } from '@agenthq/core'
import { useState } from 'react'
import { activityIcon } from '../scene/plan'
import { answer } from '../state/asks'

/** A prompt waiting on you, answered right here: a permission to give, or questions to choose answers for. */
export function AskCard({ ask }: { ask: Ask }) {
  return ask.kind === 'question' ? <QuestionCard ask={ask} /> : <PermissionCard ask={ask} />
}

function PermissionCard({ ask }: { ask: Ask }) {
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (reply: Parameters<typeof answer>[0]) => {
    setBusy(true)
    if (!(await answer(reply))) setBusy(false)
  }
  return (
    <div className="ask" role="group" aria-label={`${ask.tool.name} asks for permission`}>
      <p className="ask-title">
        ✋ <b>{ask.tool.name}</b> needs your permission
        {ask.tool.target && ask.tool.target !== ask.input ? <span> · {ask.tool.target}</span> : null}
      </p>
      {ask.input && <pre className="ask-input">{ask.input}</pre>}
      {denying ? (
        <form
          className="ask-deny"
          onSubmit={(event) => {
            event.preventDefault()
            void send({ id: ask.id, choice: 'deny', message: reason })
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Tell it what to do instead (optional)"
            aria-label="Why not"
          />
          <button type="submit" className="btn danger" disabled={busy}>
            Deny
          </button>
          <button type="button" className="btn" onClick={() => setDenying(false)}>
            Back
          </button>
        </form>
      ) : (
        <div className="ask-actions">
          <button className="btn primary" disabled={busy} onClick={() => void send({ id: ask.id, choice: 'once' })}>
            Allow once
          </button>
          {ask.always.map((text, index) => (
            <button key={text} className="btn" disabled={busy} onClick={() => void send({ id: ask.id, choice: 'always', index })}>
              {text}
            </button>
          ))}
          <button className="btn danger" disabled={busy} onClick={() => setDenying(true)}>
            Deny…
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionCard({ ask }: { ask: Ask }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const valueOf = (question: string) =>
    [...(picked[question] ?? []), ...(other[question]?.trim() ? [other[question]!.trim()] : [])].join(', ')
  const ready = ask.questions.every((q) => valueOf(q.question))
  const toggle = (question: string, label: string, multi: boolean) =>
    setPicked((current) => {
      const now = current[question] ?? []
      if (!multi) return { ...current, [question]: now[0] === label ? [] : [label] }
      return { ...current, [question]: now.includes(label) ? now.filter((l) => l !== label) : [...now, label] }
    })
  const send = async () => {
    setBusy(true)
    const answers = Object.fromEntries(ask.questions.map((q) => [q.question, valueOf(q.question)]))
    if (!(await answer({ id: ask.id, choice: 'answers', answers }))) setBusy(false)
  }
  return (
    <div className="ask" role="group" aria-label="It asks you">
      <p className="ask-title">
        {activityIcon[ask.tool.activity]} <b>It asks you</b>
      </p>
      {ask.questions.map((q) => (
        <fieldset key={q.question} className="ask-question">
          <legend>
            {q.header && <small>{q.header}</small>}
            {q.question}
          </legend>
          <div className="ask-options">
            {q.options.map((option) => {
              const on = (picked[q.question] ?? []).includes(option.label)
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`option${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    toggle(q.question, option.label, q.multiSelect)
                    if (!q.multiSelect) setOther((current) => ({ ...current, [q.question]: '' }))
                  }}
                >
                  <b>{option.label}</b>
                  {option.description && <span>{option.description}</span>}
                </button>
              )
            })}
          </div>
          <input
            className="ask-other"
            value={other[q.question] ?? ''}
            onChange={(event) => {
              setOther((current) => ({ ...current, [q.question]: event.target.value }))
              if (!q.multiSelect) setPicked((current) => ({ ...current, [q.question]: [] }))
            }}
            placeholder={q.multiSelect ? 'Add something else (optional)' : 'Or type your own answer'}
            aria-label={`Your own answer to: ${q.question}`}
          />
        </fieldset>
      ))}
      <div className="ask-actions">
        <button className="btn primary" disabled={!ready || busy} onClick={() => void send()}>
          Send {ask.questions.length > 1 ? 'answers' : 'answer'}
        </button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => void answer({ id: ask.id, choice: 'deny', message: 'The user declined to answer.' })}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
