// Stands in for the Claude Agent SDK in tests (AGENTHQ_TEST_AGENT): the same `query()` shape,
// writing made-up transcript lines into the made-up ~/.claude, so no real Claude Code runs.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const line = (value) => JSON.stringify(value) + '\n'

export function query({ prompt, options }) {
  const home = process.env.AGENTHQ_CLAUDE_HOME
  const sessionId = options.resume ?? options.sessionId
  const dir = join(home, 'projects', options.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const write = (entry) =>
    appendFileSync(
      join(dir, `${sessionId}.jsonl`),
      line({ cwd: options.cwd, sessionId, timestamp: new Date().toISOString(), ...entry }),
    )
  const say = (text) =>
    write({
      type: 'assistant',
      uuid: `a-${Date.now()}-${Math.random()}`,
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    })
  let closed = false
  const controller = new AbortController()

  async function* run() {
    for await (const message of prompt) {
      if (closed) return
      const text = message.message.content
      write({ type: 'user', uuid: `u-${Date.now()}`, message: { role: 'user', content: text } })
      if (/deploy/i.test(text)) {
        const input = { command: 'npm run deploy', description: 'Deploy' }
        const id = `toolu_${Date.now()}`
        write({
          type: 'assistant',
          uuid: `t-${Date.now()}`,
          message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input }] },
        })
        const decision = await options.canUseTool('Bash', input, {
          signal: controller.signal,
          toolUseID: id,
          suggestions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Bash', ruleContent: 'npm run deploy:*' }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ],
        })
        const allowed = decision.behavior === 'allow'
        write({
          type: 'user',
          uuid: `r-${Date.now()}`,
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: id, content: allowed ? 'deployed' : decision.message, is_error: !allowed },
            ],
          },
        })
        say(allowed ? 'Deployed.' : 'Not deployed.')
      } else if (/slowly/i.test(text) && options.includePartialMessages) {
        // The reply as it's written, a word at a time, as the SDK streams it; the transcript line comes last.
        const reply = 'Once upon a time, a tiny office worked through the night.'
        const event = (value) => ({ type: 'stream_event', event: value, parent_tool_use_id: null, uuid: `s-${Date.now()}` })
        yield event({ type: 'message_start', message: {} })
        yield event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        for (const word of reply.split(/(?<= )/)) {
          await new Promise((resolve) => setTimeout(resolve, 350))
          if (closed) return
          yield event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } })
        }
        yield event({ type: 'content_block_stop', index: 0 })
        yield event({ type: 'message_stop' })
        await new Promise((resolve) => setTimeout(resolve, 300))
        say(reply)
      } else {
        say(`You said: ${text}`)
      }
      yield { type: 'result', subtype: 'success' }
    }
  }
  const iterator = run()
  return Object.assign(iterator, {
    interrupt: async () => undefined,
    close: () => {
      closed = true
      controller.abort()
      void iterator.return(undefined)
    },
  })
}
