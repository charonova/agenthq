// Starts AgentHQ on a made-up ~/.claude, for Playwright (see playwright.config.ts).
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClaudeHome, makeCodexHome } from './fixture-home.mjs'

const home = makeClaudeHome(mkdtempSync(join(tmpdir(), 'agenthq-e2e-')))
const codex = makeCodexHome(mkdtempSync(join(tmpdir(), 'agenthq-e2e-codex-')))
const port = process.env.PORT ?? '4799'
// AgentHQ's own folder (the hook's server file), where the tests find it.
const state = join(tmpdir(), `agenthq-e2e-state-${port}`)
// Switches turned on by an earlier run start off again.
rmSync(state, { recursive: true, force: true })
// The example plugin, with one made-up session of its own.
mkdirSync(join(state, 'plugins'), { recursive: true })
copyFileSync(join(import.meta.dirname, '..', 'docs', 'plugins', 'hello-agent.mjs'), join(state, 'plugins', 'hello-agent.mjs'))
const hello = mkdtempSync(join(tmpdir(), 'agenthq-e2e-hello-'))
mkdirSync(join(hello, 'sessions'))
const at = (ago) => new Date(Date.now() - ago * 1000).toISOString()
writeFileSync(
  join(hello, 'sessions', 'hello-1.jsonl'),
  [
    { time: at(60), role: 'user', cwd: '/Users/alex/Code/garden', text: 'Water the plants' },
    { time: at(30), role: 'agent', text: 'Watering them now.' },
    { time: at(2), role: 'agent', tool: 'Edit', target: 'plants.ts' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n',
)
// A folder to start sessions in; a stand-in agent runs them (never real Claude Code).
mkdirSync(join(tmpdir(), `agenthq-e2e-project-${port}`), { recursive: true })
const agent = pathToFileURL(join(import.meta.dirname, 'fake-agent.mjs')).href
const child = spawn(process.execPath, ['packages/cli/dist/cli.js', '--no-open', '--port', port, '--plugins'], {
  stdio: 'inherit',
  // Tests never bring the developer's own windows forward.
  env: {
    ...process.env,
    AGENTHQ_CLAUDE_HOME: home,
    CODEX_HOME: codex,
    AGENTHQ_JUMP: 'copy',
    AGENTHQ_STATE_DIR: state,
    AGENTHQ_TEST_AGENT: agent,
    HELLO_AGENT_HOME: hello,
  },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
