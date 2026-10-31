import type { Agent, Office } from '@agenthq/core'
import { describe, expect, it } from 'vitest'
import { Asks, describeSuggestion } from '../src/asks'

const agent = (id: string, transcript: string, updatedAt = 0): Agent =>
  ({ id, name: id, role: id === 's1' ? 'manager' : 'staff', transcript, updatedAt }) as Agent
const office = (updatedAt = 0): Office =>
  ({
    kind: 'claude',
    sessionId: 's1',
    ended: false,
    manager: agent('s1', '/p/s1.jsonl', updatedAt),
    staff: [agent('qa', '/p/s1/subagents/agent-qa.jsonl', updatedAt)],
    interns: [],
  }) as unknown as Office

const question = {
  hook_event_name: 'PermissionRequest',
  session_id: 's1',
  transcript_path: '/p/s1/subagents/agent-qa.jsonl',
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Green' }, { label: 'Blue' }] },
    ],
  },
}
const bash = {
  session_id: 's1',
  transcript_path: '/p/s1.jsonl',
  tool_name: 'Bash',
  tool_input: { command: 'npm test', description: 'Run the tests' },
  permission_suggestions: [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
    { type: 'removeRules', rules: [], destination: 'session' },
  ],
}

describe('prompts waiting on you', () => {
  it('shows a question as its asker’s, and answers it with your choices', async () => {
    const asks = new Asks(() => {})
    asks.update([office()])
    const decision = asks.add(question, () => {})
    const [ask] = asks.list()
    expect(ask).toMatchObject({
      agentId: 'qa',
      kind: 'question',
      questions: [{ question: 'Which colour?', options: [{ label: 'Green' }, { label: 'Blue' }] }],
    })
    expect(asks.answer({ id: ask!.id, choice: 'answers', answers: {} })).toMatchObject({ ok: false })
    expect(asks.answer({ id: ask!.id, choice: 'answers', answers: { 'Which colour?': 'Blue' } })).toMatchObject({ ok: true })
    expect(await decision).toEqual({
      behavior: 'allow',
      updatedInput: { ...question.tool_input, answers: { 'Which colour?': 'Blue' } },
    })
    expect(asks.list()).toEqual([])
  })

  it('offers Claude Code’s own “always” choices, and passes the chosen one back as it came', async () => {
    const asks = new Asks(() => {})
    asks.update([office()])
    const decision = asks.add(bash, () => {})
    const [ask] = asks.list()
    expect(ask).toMatchObject({
      agentId: 's1',
      kind: 'permission',
      input: 'npm test',
      always: ['Always allow Bash(npm test:*) in this project'],
    })
    expect(asks.answer({ id: ask!.id, choice: 'always', index: 3 })).toMatchObject({ ok: false })
    asks.answer({ id: ask!.id, choice: 'always', index: 0 })
    expect(await decision).toEqual({ behavior: 'allow', updatedPermissions: [bash.permission_suggestions[0]] })
  })

  it('denies with your reason', async () => {
    const asks = new Asks(() => {})
    asks.update([office()])
    const decision = asks.add(bash, () => {})
    asks.answer({ id: asks.list()[0]!.id, choice: 'deny', message: 'use pnpm' })
    expect(await decision).toEqual({ behavior: 'deny', message: 'use pnpm' })
  })

  it('lets go when the terminal answered (its transcript moved on) or the hook gave up', async () => {
    const asks = new Asks(() => {})
    asks.update([office()])
    const answeredThere = asks.add(bash, () => {})
    let giveUp = () => {}
    const gaveUp = asks.add(question, (drop) => (giveUp = drop))
    giveUp()
    expect(await gaveUp).toBeNull()
    asks.update([office(Date.now() + 5000)])
    expect(await answeredThere).toBeNull()
    expect(asks.list()).toEqual([])
  })

  it('describes suggestions in words', () => {
    expect(describeSuggestion({ type: 'setMode', mode: 'acceptEdits', destination: 'session' })).toBe(
      'Accept all edits for this session',
    )
    expect(describeSuggestion({ type: 'addDirectories', directories: ['/tmp/x'], destination: 'session' })).toBe(
      'Allow access to /tmp/x for this session',
    )
    expect(describeSuggestion({ type: 'removeRules' })).toBeNull()
  })
})
