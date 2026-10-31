import type { Agent, Office } from '@agenthq/core'
import { useEffect, useRef } from 'react'
import { drawPerson, figures, hairColors, lookFor, skins, styles, type HairStyle, type LookChoice } from '../scene/art/people'
import { useSettings } from '../state/store'
import { lookKeyOf } from '../state/view'

/** Choosing someone's look: figure, skin, hair colour and style. Kept in this browser, for them in every session. */
export function LookEditor({ agent, office }: { agent: Agent; office: Office }) {
  const looks = useSettings((state) => state.looks)
  const set = useSettings((state) => state.set)
  const key = lookKeyOf(agent, office)
  const choice = looks[key] ?? {}
  const look = lookFor(agent.name + agent.id, agent.color, agent.role, choice)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, 24, 26)
    drawPerson(ctx, look, 12, 24, 'stand', 1)
  }, [look])

  const change = (part: LookChoice) => set({ looks: { ...looks, [key]: { ...choice, ...part } } })
  const reset = () => {
    const next = { ...looks }
    delete next[key]
    set({ looks: next })
  }

  return (
    <div className="look-editor" aria-label="Their look">
      <canvas ref={canvas} width={24} height={26} className="look-preview" aria-hidden />
      <div className="look-parts">
        <div className="segmented" role="radiogroup" aria-label="Figure">
          {figures.map((figure) => (
            <button key={figure} role="radio" aria-checked={look.figure === figure} onClick={() => change({ figure })}>
              {figure === 'man' ? 'Man' : 'Woman'}
            </button>
          ))}
        </div>
        <div className="swatches" role="radiogroup" aria-label="Skin">
          {skins.map((skin) => (
            <button
              key={skin}
              role="radio"
              aria-checked={look.skin === skin}
              aria-label={`Skin ${skin}`}
              style={{ background: skin }}
              onClick={() => change({ skin })}
            />
          ))}
        </div>
        <div className="swatches" role="radiogroup" aria-label="Hair colour">
          {hairColors.map((hair) => (
            <button
              key={hair}
              role="radio"
              aria-checked={look.hair === hair}
              aria-label={`Hair ${hair}`}
              style={{ background: hair }}
              onClick={() => change({ hair })}
            />
          ))}
        </div>
        <select
          aria-label="Hair style"
          value={look.style}
          onChange={(event) => change({ style: event.target.value as HairStyle })}
        >
          {styles.map((style) => (
            <option key={style} value={style}>
              {style[0]!.toUpperCase() + style.slice(1)} hair
            </option>
          ))}
        </select>
        {looks[key] && (
          <button className="btn" onClick={reset}>
            Back to their own look
          </button>
        )}
      </div>
    </div>
  )
}
