import type { Office } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { hairColors, lookFor, skins } from '../src/scene/art/people'
import { NIGHT, darknessAt, lookKeyOf, reducedMotion, themeDarkness, visibleOffices } from '../src/state/view'

const office = (sessionId: string, extra: Partial<Office> = {}) =>
  ({ sessionId, kind: 'claude', ended: false, ...extra }) as Office

describe('day and night', () => {
  const noon = new Date(2026, 9, 31, 12, 0)
  const midnight = new Date(2026, 9, 31, 0, 30)
  it('follows the clock, or stays day or night', () => {
    expect(darknessAt(noon)).toBe(0)
    expect(darknessAt(midnight)).toBe(NIGHT)
    expect(darknessAt(new Date(2026, 9, 31, 19, 0))).toBeCloseTo(NIGHT / 2)
    expect(themeDarkness('clock', midnight)).toBe(NIGHT)
    expect(themeDarkness('day', midnight)).toBe(0)
    expect(themeDarkness('night', noon)).toBe(NIGHT)
  })
})

describe('motion', () => {
  it('is reduced when chosen, or when the computer asks and the setting follows it', () => {
    expect(reducedMotion('system', true)).toBe(true)
    expect(reducedMotion('system', false)).toBe(false)
    expect(reducedMotion('full', true)).toBe(false)
    expect(reducedMotion('reduced', false)).toBe(true)
  })
})

describe('hiding offices', () => {
  const offices = [office('a'), office('b', { ended: true }), office('c', { kind: 'codex' })]
  const ids = (list: Office[]) => list.map((o) => o.sessionId)
  it('leaves out the ones hidden, and ended or Codex ones when asked', () => {
    expect(ids(visibleOffices(offices, { hidden: [], hideEnded: false, hideCodex: false }))).toEqual(['a', 'b', 'c'])
    expect(ids(visibleOffices(offices, { hidden: ['a'], hideEnded: false, hideCodex: false }))).toEqual(['b', 'c'])
    expect(ids(visibleOffices(offices, { hidden: [], hideEnded: true, hideCodex: true }))).toEqual(['a'])
  })
})

describe('choosing someone’s look', () => {
  it('keeps a teammate’s choice by name, and a manager’s by project', () => {
    expect(lookKeyOf({ role: 'staff', name: 'qa' }, { project: 'shop' })).toBe('staff:qa')
    expect(lookKeyOf({ role: 'manager', name: 'Manager' }, { project: 'shop' })).toBe('manager:shop')
  })

  it('changes only what was chosen, and only to looks the art has', () => {
    const own = lookFor('qa-1', 'green', 'staff')
    const chosen = lookFor('qa-1', 'green', 'staff', { figure: own.figure === 'man' ? 'woman' : 'man', skin: skins[0] })
    expect(chosen).toMatchObject({ hair: own.hair, style: own.style, shirt: own.shirt, skin: skins[0] })
    expect(chosen.figure).not.toBe(own.figure)
    const odd = lookFor('qa-1', 'green', 'staff', { hair: 'url(x)', style: 'mohawk' as never })
    expect(hairColors).toContain(odd.hair)
    expect(odd).toMatchObject({ hair: own.hair, style: own.style })
  })
})
