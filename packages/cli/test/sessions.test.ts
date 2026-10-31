import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Office } from '@agenthq/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Asks } from '../src/asks'
import { findClaude, Sessions } from '../src/sessions'

// The stand-in for the Agent SDK that the browser tests use: no real Claude Code runs.
const agent = pathToFileURL(join(import.meta.dirname, '../../../e2e/fake-agent.mjs')).href
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
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
