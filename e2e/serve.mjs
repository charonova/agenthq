// Starts AgentHQ on a made-up ~/.claude, for Playwright (see playwright.config.ts).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeClaudeHome, makeCodexHome } from './fixture-home.mjs'

const home = makeClaudeHome(mkdtempSync(join(tmpdir(), 'agenthq-e2e-')))
const codex = makeCodexHome(mkdtempSync(join(tmpdir(), 'agenthq-e2e-codex-')))
const port = process.env.PORT ?? '4799'
// AgentHQ's own folder (the hook's server file), where the tests find it.
const state = join(tmpdir(), `agenthq-e2e-state-${port}`)
const child = spawn(process.execPath, ['packages/cli/dist/cli.js', '--no-open', '--port', port], {
  stdio: 'inherit',
  // Tests never bring the developer's own windows forward.
  env: { ...process.env, AGENTHQ_CLAUDE_HOME: home, CODEX_HOME: codex, AGENTHQ_JUMP: 'copy', AGENTHQ_STATE_DIR: state },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
