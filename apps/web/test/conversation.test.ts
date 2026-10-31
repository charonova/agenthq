import type { Message } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { addPage, emptyLoaded, landed, matches } from '../src/state/conversation'

const bash = { name: 'Bash', activity: 'run', target: 'pnpm test' } as const
const call = (id: string): Message => ({ kind: 'tool', id, at: null, tool: bash, input: 'pnpm test', result: null })
const said = (id: string, text: string): Message => ({ kind: 'assistant', id, at: null, text })

describe('loading a conversation page by page', () => {
  it('appends newer pages and puts a late result on its call', () => {
    const first = addPage(emptyLoaded, { messages: [said('a', 'hi'), call('t1')], start: 500, end: 900 }, 'newer')
    const next = addPage(
      first,
      {
        messages: [{ kind: 'result', id: 'r', at: null, toolId: 't1', result: { text: 'ok', isError: false } }],
        start: 900,
        end: 1000,
      },
      'newer',
    )
    expect(next).toMatchObject({ start: 500, end: 1000, orphans: {} })
    expect(next.messages).toHaveLength(2)
    expect(next.messages[1]).toMatchObject({ kind: 'tool', result: { text: 'ok' } })
  })

  it('keeps a result whose call is older until that page comes', () => {
    const newest = addPage(
      emptyLoaded,
      {
        messages: [
          { kind: 'result', id: 'r', at: null, toolId: 't0', result: { text: 'done', isError: true } },
          said('b', 'next'),
        ],
        start: 400,
        end: 900,
      },
      'newer',
    )
    expect(newest.orphans).toHaveProperty('t0')
    const older = addPage(newest, { messages: [call('t0')], start: 0, end: 400 }, 'older')
    expect(older.start).toBe(0)
    expect(older.messages.map((m) => m.id)).toEqual(['t0', 'b'])
    expect(older.messages[0]).toMatchObject({ result: { isError: true } })
  })

  it('never shows a message twice', () => {
    const page = { messages: [said('a', 'hi')], start: 0, end: 10 }
    expect(addPage(addPage(emptyLoaded, page, 'newer'), page, 'newer').messages).toHaveLength(1)
  })

  it('searches every text of a message', () => {
    expect(matches(said('a', 'Fixed the Login bug'), 'login')).toBe(true)
    expect(matches({ ...call('t'), result: { text: '3 failed', isError: true } } as Message, 'FAILED')).toBe(true)
    expect(matches(said('a', 'hello'), 'bye')).toBe(false)
  })
})

describe('a reply being written', () => {
  const draft = { id: 'd', text: 'Once upon a time, a tiny office', startedAt: 10_000, final: false }
  const reply = (text: string, at: number): Message => ({ kind: 'assistant', id: `r${at}`, at, text })

  it('gives way to the transcript once a reply that starts the same way lands', () => {
    expect(landed(draft, [])).toBe(false)
    expect(landed(draft, [reply('Once upon a time, a tiny office worked through the night.', 14_000)])).toBe(true)
  })

  it('isn’t mistaken for an earlier reply that said the same', () => {
    expect(landed(draft, [reply('Once upon a time, a tiny office worked.', 2_000)])).toBe(false)
    expect(landed({ ...draft, text: '  ' }, [reply('  ', 14_000)])).toBe(false)
  })
})
