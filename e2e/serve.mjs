// Starts AgentHQ on a made-up ~/.claude, for Playwright (see playwright.config.ts).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeClaudeHome } from './fixture-home.mjs'

const home = makeClaudeHome(mkdtempSync(join(tmpdir(), 'agenthq-e2e-')))
const port = process.env.PORT ?? '4799'
const child = spawn(process.execPath, ['packages/cli/dist/cli.js', '--no-open', '--port', port], {
  stdio: 'inherit',
  env: { ...process.env, AGENTHQ_CLAUDE_HOME: home },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
