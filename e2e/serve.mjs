// Starts AgentHQ on a made-up ~/.claude, for Playwright (see playwright.config.ts).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
// A folder to start sessions in; a stand-in agent runs them (never real Claude Code).
mkdirSync(join(tmpdir(), `agenthq-e2e-project-${port}`), { recursive: true })
const agent = pathToFileURL(join(import.meta.dirname, 'fake-agent.mjs')).href
const child = spawn(process.execPath, ['packages/cli/dist/cli.js', '--no-open', '--port', port], {
  stdio: 'inherit',
  // Tests never bring the developer's own windows forward.
  env: {
    ...process.env,
    AGENTHQ_CLAUDE_HOME: home,
    CODEX_HOME: codex,
    AGENTHQ_JUMP: 'copy',
    AGENTHQ_STATE_DIR: state,
    AGENTHQ_TEST_AGENT: agent,
  },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
