// A made-up ~/.claude with live sessions, shaped like Claude Code's own files: for end-to-end
// tests and README screenshots, so neither ever shows anyone's real work.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const line = (value) => JSON.stringify(value)
const iso = (now, secondsAgo) => new Date(now - secondsAgo * 1000).toISOString()

function transcript(path, lines, now, secondsAgo) {
  writeFileSync(path, lines.join('\n') + '\n')
  const time = (now - secondsAgo * 1000) / 1000
  utimesSync(path, time, time)
}

const usage = { input_tokens: 12, cache_creation_input_tokens: 900, cache_read_input_tokens: 48_000, output_tokens: 300 }

function tool(cwd, now, ago, name, input) {
  return line({
    type: 'assistant',
    cwd,
    timestamp: iso(now, ago),
    message: {
      model: 'claude-opus-5-5',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't', name, input }],
      usage,
    },
  })
}
const prompt = (cwd, now, ago, text) =>
  line({ type: 'user', cwd, timestamp: iso(now, ago), message: { role: 'user', content: text } })
const done = (cwd, now, ago) =>
  line({
    type: 'assistant',
    cwd,
    timestamp: iso(now, ago),
    message: {
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'All done: the export works and the tests pass.' }],
      usage,
    },
  })
const result = (cwd, now, ago) =>
  line({
    type: 'user',
    cwd,
    timestamp: iso(now, ago),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
  })

export function makeClaudeHome(root, now = Date.now()) {
  const session = (project, id, title, lines, ago) => {
    const cwd = `/Users/alex/Code/${project}`
    const dir = join(root, 'projects', `-Users-alex-Code-${project}`)
    mkdirSync(join(dir, id, 'subagents'), { recursive: true })
    transcript(join(dir, `${id}.jsonl`), [line({ type: 'ai-title', aiTitle: title }), ...lines(cwd)], now, ago)
    const subagent = (agentId, meta, agentLines, agentAgo) => {
      writeFileSync(join(dir, id, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify(meta))
      transcript(join(dir, id, 'subagents', `agent-${agentId}.jsonl`), agentLines(cwd), now, agentAgo)
    }
    return subagent
  }
  const teammate = (name, color) => ({
    name,
    color,
    spawnDepth: 0,
    taskKind: 'in_process_teammate',
    permissionMode: 'auto',
    model: 'claude-opus-5-5',
  })

  const shop = session(
    'shop',
    'session-shop',
    'Add CSV export to orders',
    (cwd) => [prompt(cwd, now, 900, 'add a CSV export'), done(cwd, now, 400)],
    400,
  )
  shop('aapi-1', teammate('api', 'blue'), (cwd) => [tool(cwd, now, 2, 'Edit', { file_path: `${cwd}/src/export.ts` })], 2)
  shop(
    'aqa-2',
    teammate('qa', 'green'),
    (cwd) => [tool(cwd, now, 60, 'Bash', { command: 'pnpm vitest run', description: 'Run the export tests' })],
    60,
  )
  shop('adocs-3', teammate('docs', 'purple'), (cwd) => [tool(cwd, now, 3, 'Read', { file_path: `${cwd}/README.md` })], 3)
  shop('aui-4', teammate('ui', 'pink'), (cwd) => [tool(cwd, now, 4, 'SendMessage', { to: 'api', message: 'Which columns?' })], 4)
  shop('ainfra-5', teammate('infra', 'orange'), (cwd) => [done(cwd, now, 300)], 300)
  shop('adata-6', teammate('data', 'cyan'), (cwd) => [done(cwd, now, 1800)], 1800)
  shop(
    'a7f3',
    { spawnDepth: 1, parentAgentId: 'aapi-1', description: 'Find a CSV streaming library' },
    (cwd) => [tool(cwd, now, 2, 'WebSearch', { query: 'csv streaming node' })],
    2,
  )

  const blog = session(
    'blog',
    'session-blog',
    'Write the launch post',
    (cwd) => [prompt(cwd, now, 120, 'draft the post'), tool(cwd, now, 40, 'Bash', { command: 'npm run build' })],
    40,
  )
  void blog
  session('api', 'session-api', 'Fix the login redirect', (cwd) => [prompt(cwd, now, 30, 'fix it'), result(cwd, now, 1)], 1)
  return root
}
