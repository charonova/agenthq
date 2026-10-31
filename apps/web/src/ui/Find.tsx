import { useEffect, useMemo, useRef, useState } from 'react'
import { describe, stateEmoji } from '../scene/plan'
import { goToAgent } from '../state/asks'
import { findAgents, type Filter } from '../state/search'
import { useOffices } from '../state/store'
import { useNow } from './useNow'

const filterNames: [Filter, string][] = [
  ['all', 'Everyone'],
  ['waiting', '✋ Waiting'],
  ['working', '⌨️ Working'],
  ['resting', '☕ Resting'],
]

/** 🔍 in the header: find an agent, a file or a command, or everyone waiting. "/" jumps here. */
export function Find() {
  const offices = useOffices((state) => state.offices)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const now = useNow()
  const hits = useMemo(() => (open ? findAgents(offices, query, filter) : []), [offices, query, filter, open])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || target?.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      input.current?.focus()
    }
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  const go = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    goToAgent(hit.office.sessionId, hit.agent.id)
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="find" ref={box}>
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Find an agent, a file… ( / )"
        aria-label="Find an agent, a file or a command"
        aria-expanded={open}
        aria-controls="find-results"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') setActive((index) => Math.min(index + 1, hits.length - 1))
          else if (event.key === 'ArrowUp') setActive((index) => Math.max(index - 1, 0))
          else if (event.key === 'Enter') go(active)
          else if (event.key === 'Escape') {
            setOpen(false)
            input.current?.blur()
          } else return
          event.preventDefault()
        }}
      />
      {open && (
        <div className="find-results" id="find-results">
          <div className="segmented" role="radiogroup" aria-label="Show">
            {filterNames.map(([value, text]) => (
              <button
                key={value}
                role="radio"
                aria-checked={filter === value}
                onClick={() => {
                  setFilter(value)
                  setActive(0)
                  input.current?.focus()
                }}
              >
                {text}
              </button>
            ))}
          </div>
          <ul role="listbox" aria-label="Found">
            {hits.map((hit, index) => (
              <li
                key={`${hit.office.sessionId}/${hit.agent.id}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  go(index)
                }}
              >
                <span className="emoji">{stateEmoji(hit.agent)}</span>
                <span className="text">
                  <b>
                    {hit.agent.role === 'manager'
                      ? 'Manager'
                      : hit.agent.role === 'intern'
                        ? (hit.agent.task ?? hit.agent.name)
                        : hit.agent.name}
                  </b>
                  <small>{hit.office.project}</small>
                  <span>{hit.why ?? describe(hit.agent, now)}</span>
                </span>
              </li>
            ))}
            {hits.length === 0 && <li className="none">Nobody found.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
