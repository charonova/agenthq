// How much the page costs with a big building (100+ made-up agents): CPU time per second of
// the page's main thread, in the whole building and inside one office. Needs `pnpm build` and Chrome.
// `--software` draws without the GPU (like a slow machine); `--cli <path>` measures another build.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeBigClaudeHome } from '../e2e/fixture-home.mjs'

const port = 4791
const flag = (name) => process.argv.indexOf(name)
const cli = flag('--cli') > 0 ? process.argv[flag('--cli') + 1] : 'packages/cli/dist/cli.js'
const software = flag('--software') > 0
const home = makeBigClaudeHome(mkdtempSync(join(tmpdir(), 'agenthq-bench-')))
const codex = mkdtempSync(join(tmpdir(), 'agenthq-bench-codex-'))
const server = spawn(process.execPath, [cli, '--no-open', '--port', String(port)], {
  stdio: 'ignore',
  env: { ...process.env, AGENTHQ_CLAUDE_HOME: home, CODEX_HOME: codex, AGENTHQ_JUMP: 'copy' },
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  await sleep(1500)
  const browser = await chromium.launch({
    channel: 'chrome',
    args: software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))

  /** Main-thread busy time per second, and frames per second, over `seconds`. */
  const measure = async (label, seconds = 6) => {
    await sleep(2500) // the camera settles, people reach their places
    const before = await metrics()
    const frames = await page.evaluate(
      /* global requestAnimationFrame */
      (ms) =>
        new Promise((resolve) => {
          let count = 0
          const end = performance.now() + ms
          const step = () => (performance.now() < end ? (count++, requestAnimationFrame(step)) : resolve(count))
          requestAnimationFrame(step)
        }),
      seconds * 1000,
    )
    const after = await metrics()
    const busy = (key) => ((after[key] - before[key]) / seconds) * 1000
    console.log(
      `${label.padEnd(10)} busy ${busy('TaskDuration').toFixed(0).padStart(4)} ms/s · script ${busy('ScriptDuration')
        .toFixed(0)
        .padStart(4)} ms/s · ${(frames / seconds).toFixed(0)} frames/s`,
    )
  }

  await page.goto(`http://localhost:${port}/`)
  await page.waitForSelector('.office-row')
  const agents = await page.evaluate(async () => {
    const offices = await (await fetch('/api/offices')).json()
    return offices.reduce((n, office) => n + 1 + office.staff.length + office.interns.length, 0)
  })
  console.log(`${agents} agents in ${await page.locator('.office-row').count()} offices`)
  await measure('building')
  await page.locator('.office-row').first().click()
  await measure('one office')
  await browser.close()
} finally {
  server.kill()
  rmSync(home, { recursive: true, force: true })
  rmSync(codex, { recursive: true, force: true })
}
