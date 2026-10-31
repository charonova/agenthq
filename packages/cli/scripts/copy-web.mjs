// Ships the built office page inside the CLI package: dist/web, served by dist/cli.js.
import { cpSync, existsSync } from 'node:fs'

const from = new URL('../../../apps/web/dist', import.meta.url)
if (!existsSync(from)) {
  console.error('Build the web app first: pnpm --filter @agenthq/web build')
  process.exit(1)
}
cpSync(from, new URL('../dist/web', import.meta.url), { recursive: true })
