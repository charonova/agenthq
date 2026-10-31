import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Draft, Office } from '@agenthq/core'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Asks } from '../src/asks'
import { findClaude, nextDraft, Sessions } from '../src/sessions'

// The stand-in for the Agent SDK that the browser tests use: no real Claude Code runs.
const agent = pathToFileURL(join(import.meta.dirname, '../../../e2e/fake-agent.mjs')).href
const until = async (check: () => boolean, tries = 200) => {
  for (let i = 0; i < tries && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(check()).toBe(true)
}

describe('sessions AgentHQ runs', () => {
  let home: string
  let project: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agenthq-sessions-'))
    project = mkdtempSync(join(tmpdir(), 'agenthq-project-'))
    process.env.AGENTHQ_CLAUDE_HOME = home
    process.env.AGENTHQ_TEST_AGENT = agent
  })
  afterEach(() => {
    delete process.env.AGENTHQ_CLAUDE_HOME
    delete process.env.AGENTHQ_TEST_AGENT
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  const transcript = (id: string) => {
    const dir = join(home, 'projects', readdirSync(join(home, 'projects'))[0]!)
    return readFileSync(join(dir, `${id}.jsonl`), 'utf8')
  }

  it('starts with your message, takes more, and holds its prompts for you', async () => {
    const asks = new Asks(() => {})
    const sessions = new Sessions(asks, () => {})
    const id = await sessions.start({ cwd: project, prompt: 'deploy it' })
    asks.update([{ kind: 'claude', sessionId: id, manager: { id, transcript: '' }, staff: [], interns: [] } as unknown as Office])
    await until(() => asks.list().length === 1)
    const [ask] = asks.list()
    expect(ask).toMatchObject({
      sessionId: id,
      agentId: id,
      input: 'npm run deploy',
      always: ['Always allow Bash(npm run deploy:*) in this project'],
    })
    asks.answer({ id: ask!.id, choice: 'once' })
    await until(() => sessions.info(id)?.busy === false)
    expect(transcript(id)).toContain('Deployed.')
    sessions.send(id, 'thanks')
    await until(() => transcript(id).includes('You said: thanks'))
    sessions.stop(id)
    expect(sessions.info(id)).toBeNull()
    expect(() => sessions.send(id, 'hello?')).toThrow()
  })

  it('streams the reply as it’s written, then lets the transcript take over', async () => {
    const seen: (Draft | null)[] = []
    const sessions = new Sessions(
      new Asks(() => {}),
      () => {},
      (_id, draft) => seen.push(draft),
    )
    const id = await sessions.start({ cwd: project, prompt: 'tell it slowly' })
    await until(() => seen.some((draft) => draft?.text.startsWith('Once upon')))
    expect(transcript(id)).not.toContain('Once upon')
    expect(sessions.drafts()[id]?.final).toBe(false)
    await until(() => seen.at(-1)?.final === true, 800)
    expect(seen.at(-1)?.text).toBe('Once upon a time, a tiny office worked through the night.')
    await until(() => transcript(id).includes('Once upon a time'), 800)
    sessions.stop(id)
    expect(seen.at(-1)).toBeNull()
  }, 10_000)

  it('needs a folder that exists and a message', async () => {
    const sessions = new Sessions(new Asks(() => {}), () => {})
    await expect(sessions.start({ cwd: join(project, 'nope'), prompt: 'hi' })).rejects.toThrow('Pick a folder that exists')
    await expect(sessions.start({ cwd: project, prompt: '   ' })).rejects.toThrow('Write a message first')
    await expect(sessions.start({ cwd: project, prompt: 'hi', model: 'gpt' as never })).rejects.toThrow('Unknown model')
  })

  it('finds Claude Code where AGENTHQ_CLAUDE_PATH says', () => {
    const fake = join(project, 'claude')
    writeFileSync(fake, '')
    process.env.AGENTHQ_CLAUDE_PATH = fake
    expect(findClaude()).toContain('claude')
    delete process.env.AGENTHQ_CLAUDE_PATH
  })
})

describe('the reply being written', () => {
  const stream = (event: object, parent: string | null = null) =>
    ({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'u1', session_id: 's' }) as unknown as SDKMessage
  const start = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  const delta = (text: string, parent: string | null = null) =>
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent)

  it('starts with a block of text, grows with its deltas, and is final when the block ends', () => {
    let draft = nextDraft(null, start, 5)
    expect(draft).toEqual({ id: 'u1', text: '', startedAt: 5, final: false })
    draft = nextDraft(draft, delta('Hel'), 6)
    draft = nextDraft(draft, delta('lo'), 7)
    expect(draft?.text).toBe('Hello')
    draft = nextDraft(draft, stream({ type: 'content_block_stop', index: 0 }), 8)
    expect(draft).toMatchObject({ text: 'Hello', final: true, startedAt: 5 })
    // Nothing more goes into a finished block.
    expect(nextDraft(draft, delta('!'), 9)).toBe(draft)
  })

  it('leaves helpers’ text, thinking and tool input out', () => {
    const draft = nextDraft(null, start, 1)
    expect(nextDraft(draft, delta('from a helper', 'toolu_1'), 2)).toBe(draft)
    expect(
      nextDraft(draft, stream({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'hmm' } }), 2),
    ).toBe(draft)
    const tool = stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'Bash' } })
    expect(nextDraft(nextDraft(draft, delta('Hi'), 2), tool, 3)).toMatchObject({ text: 'Hi', final: true })
    expect(nextDraft(null, delta('stray'), 1)).toBeNull()
  })

  it('is final when the whole message or the turn arrives', () => {
    const draft = nextDraft(nextDraft(null, start, 1), delta('Done'), 2)
    expect(nextDraft(draft, { type: 'assistant', parent_tool_use_id: null } as unknown as SDKMessage, 3)?.final).toBe(true)
    expect(nextDraft(draft, { type: 'result', subtype: 'success' } as unknown as SDKMessage, 3)?.final).toBe(true)
  })
})
