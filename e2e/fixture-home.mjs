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

export function tool(cwd, now, ago, name, input) {
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
export const prompt = (cwd, now, ago, text) =>
  line({ type: 'user', cwd, timestamp: iso(now, ago), message: { role: 'user', content: text } })
export const done = (cwd, now, ago) =>
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

const say = (cwd, now, ago, text) =>
  line({
    type: 'assistant',
    cwd,
    timestamp: iso(now, ago),
    message: { role: 'assistant', content: [{ type: 'text', text }], usage },
  })
const call = (cwd, now, ago, id, name, input) =>
  line({
    type: 'assistant',
    cwd,
    timestamp: iso(now, ago),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage },
  })
const reply = (cwd, now, ago, id, text) =>
  line({
    type: 'user',
    cwd,
    timestamp: iso(now, ago),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  })
const teammateSays = (cwd, now, ago, from, color, summary, text) =>
  prompt(
    cwd,
    now,
    ago,
    `<teammate-message teammate_id="${from}" color="${color}" summary="${summary}">${text}</teammate-message>`,
  )

/**
 * `pid`: a live process to stand for Claude Code's (the caller's own), so the sessions count as
 * running, each with the status Claude Code would report.
 */
export function makeClaudeHome(root, now = Date.now(), pid = process.pid) {
  mkdirSync(join(root, 'sessions'), { recursive: true })
  const running = (n, sessionId, project, status) =>
    writeFileSync(
      join(root, 'sessions', `${pid}${n}.json`),
      JSON.stringify({ pid, sessionId, cwd: `/Users/alex/Code/${project}`, status, kind: 'interactive', entrypoint: 'cli' }),
    )
  running(1, 'session-shop', 'shop', 'idle')
  running(2, 'session-blog', 'blog', 'idle')
  running(3, 'session-api', 'api', 'busy')

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
    (cwd) => [
      prompt(cwd, now, 900, 'add a CSV export'),
      say(cwd, now, 880, '## Plan\n\n1. **api** writes `src/export.ts`\n2. **qa** adds the tests\n\nStarting the team now.'),
      call(cwd, now, 870, 'toolu_ls', 'Bash', { command: 'ls src', description: 'List the sources' }),
      reply(cwd, now, 869, 'toolu_ls', 'orders.ts\nexport.ts'),
      teammateSays(cwd, now, 600, 'qa', 'green', 'Tests pass', 'All 12 export tests pass on main.'),
      done(cwd, now, 400),
    ],
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

/** A made-up ~/.codex with one live thread and its "guardian" sub-agent, shaped like Codex's rollouts. */
export function makeCodexHome(root, now = Date.now()) {
  const date = new Date(now)
  const dir = join(
    root,
    'sessions',
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  )
  mkdirSync(dir, { recursive: true })
  const cwd = '/Users/alex/Code/mobile'
  const event = (ago, payload) => line({ timestamp: iso(now, ago), type: 'event_msg', payload })
  const meta = (id, extra = {}) =>
    line({
      timestamp: iso(now, 600),
      type: 'session_meta',
      payload: { id, cwd, cli_version: '0.120.0', source: 'cli', ...extra },
    })
  const done = (ago, item) => event(ago, { type: 'item_completed', completed_at_ms: now - ago * 1000, item })
  transcript(
    join(dir, 'rollout-main.jsonl'),
    [
      meta('codex-mobile'),
      line({ timestamp: iso(now, 590), type: 'turn_context', payload: { model: 'gpt-5.5-codex', cwd } }),
      event(300, { type: 'task_started' }),
      done(200, {
        type: 'CommandExecution',
        command: 'rg useAuth',
        parsed_cmd: [{ type: 'search', cmd: 'rg', query: 'useAuth', path: 'src' }],
      }),
      done(3, { type: 'FileChange', changes: { [`${cwd}/src/screens/Login.tsx`]: {} } }),
    ],
    now,
    3,
  )
  transcript(
    join(dir, 'rollout-guardian.jsonl'),
    [
      meta('codex-guardian', { source: { subagent: { other: 'guardian' } }, parent_thread_id: 'codex-mobile' }),
      event(60, { type: 'task_started' }),
      done(4, { type: 'CommandExecution', command: 'pnpm test', parsed_cmd: [{ type: 'unknown', cmd: 'pnpm test' }] }),
    ],
    now,
    4,
  )
  writeFileSync(
    join(root, 'session_index.jsonl'),
    line({ id: 'codex-mobile', thread_name: 'Sign in with Apple', updated_at: iso(now, 600) }) + '\n',
  )
  return root
}

/**
 * A big made-up ~/.claude for measuring drawing: `offices` sessions with `staff` teammates each,
 * every teammate busy with something different and one helper beside half of them.
 */
export function makeBigClaudeHome(root, { offices = 12, staff = 9, now = Date.now(), pid = process.pid } = {}) {
  mkdirSync(join(root, 'sessions'), { recursive: true })
  const jobs = [
    ['Edit', (cwd, n) => ({ file_path: `${cwd}/src/file${n}.ts` })],
    ['Read', (cwd, n) => ({ file_path: `${cwd}/docs/page${n}.md` })],
    ['Bash', () => ({ command: 'pnpm vitest run', description: 'Run the tests' })],
    ['Bash', () => ({ command: 'pnpm build', description: 'Build it' })],
    ['WebSearch', () => ({ query: 'pixel art office' })],
    ['TodoWrite', () => ({ todos: [] })],
  ]
  for (let o = 0; o < offices; o++) {
    const project = `project${o}`
    const id = `session-big-${o}`
    const cwd = `/Users/alex/Code/${project}`
    const dir = join(root, 'projects', `-Users-alex-Code-${project}`)
    mkdirSync(join(dir, id, 'subagents'), { recursive: true })
    writeFileSync(
      join(root, 'sessions', `${pid}${o}.json`),
      JSON.stringify({ pid, sessionId: id, cwd, status: 'busy', kind: 'interactive', entrypoint: 'cli' }),
    )
    transcript(
      join(dir, `${id}.jsonl`),
      [
        line({ type: 'ai-title', aiTitle: `Big job ${o}` }),
        prompt(cwd, now, 60, 'go'),
        tool(cwd, now, 2, 'Agent', { description: 'Start the team' }),
      ],
      now,
      2,
    )
    for (let s = 0; s < staff; s++) {
      const agentId = `a${o}-${s}`
      const [name, input] = jobs[(o + s) % jobs.length]
      writeFileSync(
        join(dir, id, 'subagents', `agent-${agentId}.meta.json`),
        JSON.stringify({
          name: `mate${s}`,
          color: ['blue', 'green', 'red', 'purple'][s % 4],
          spawnDepth: 0,
          taskKind: 'in_process_teammate',
          permissionMode: 'auto',
        }),
      )
      transcript(join(dir, id, 'subagents', `agent-${agentId}.jsonl`), [tool(cwd, now, 2, name, input(cwd, s))], now, 2)
      if (s % 2 === 0) {
        const helper = `h${o}-${s}`
        writeFileSync(
          join(dir, id, 'subagents', `agent-${helper}.meta.json`),
          JSON.stringify({ spawnDepth: 1, parentAgentId: agentId, description: `Helper ${s}` }),
        )
        transcript(join(dir, id, 'subagents', `agent-${helper}.jsonl`), [tool(cwd, now, 2, 'Grep', { pattern: 'todo' })], now, 2)
      }
    }
  }
  return root
}
