// Screenshots and the GIF for the README and the site, from a made-up ~/.claude: nobody's real
// work is ever shown. Plays a little story: the building, a zoom into one office, then agents
// change jobs and walk across the room. Needs `pnpm build` first, Chrome and ffmpeg.
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { done, makeClaudeHome, tool } from '../e2e/fixture-home.mjs'

const port = 4798
const out = 'docs/media'
const home = makeClaudeHome(mkdtempSync(join(tmpdir(), 'agenthq-media-')))
const server = spawn(process.execPath, ['packages/cli/dist/cli.js', '--no-open', '--port', String(port)], {
  stdio: 'ignore',
  env: { ...process.env, AGENTHQ_CLAUDE_HOME: home },
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Gives a made-up agent something new to do, as Claude Code would write it. */
function act(agentId, entry) {
  const cwd = '/Users/alex/Code/shop'
  const path = join(home, 'projects', '-Users-alex-Code-shop', 'session-shop', 'subagents', `agent-${agentId}.jsonl`)
  appendFileSync(path, entry(cwd) + '\n')
}

try {
  await sleep(1500)
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

  // Stills.
  const still = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await still.goto(`http://localhost:${port}/`)
  await still.waitForSelector('.office-row')
  await sleep(1500)
  await still.screenshot({ path: `${out}/building.png` })
  await still.locator('.office-row', { hasText: 'shop' }).click()
  await sleep(1200)
  await still.locator('.person', { hasText: 'api' }).first().click()
  await sleep(500)
  await still.screenshot({ path: `${out}/office.png` })
  await still.close()

  // The story, through Chrome's own screen stream (every frame the page paints), then a GIF.
  const framesDir = mkdtempSync(join(tmpdir(), 'agenthq-frames-'))
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
  await page.goto(`http://localhost:${port}/`)
  await page.waitForSelector('.office-row')
  await sleep(1000)
  const cdp = await page.context().newCDPSession(page)
  let frames = 0
  const started = Date.now()
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    writeFileSync(join(framesDir, `frame-${String(frames).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64'))
    frames++
    void cdp.send('Page.screencastFrameAck', { sessionId })
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 760 })
  await sleep(2200)
  await page.locator('.office-row', { hasText: 'shop' }).click()
  await sleep(1600)
  const now = () => Date.now()
  act('aqa-2', (cwd) => tool(cwd, now(), 0, 'Read', { file_path: `${cwd}/src/export.test.ts` }))
  act('adata-6', (cwd) => tool(cwd, now(), 0, 'Edit', { file_path: `${cwd}/src/columns.ts` }))
  act('ainfra-5', (cwd) => tool(cwd, now(), 0, 'SendMessage', { to: 'main', message: 'Deploy is ready' }))
  await sleep(4500)
  act('adocs-3', (cwd) =>
    tool(cwd, now(), 0, 'Bash', { command: 'pnpm vitest run docs', description: 'Check the docs examples' }),
  )
  act('aui-4', (cwd) => tool(cwd, now(), 0, 'Edit', { file_path: `${cwd}/src/ExportButton.tsx` }))
  act('aapi-1', (cwd) => done(cwd, now(), 0))
  await sleep(4500)
  await cdp.send('Page.stopScreencast')
  const seconds = (Date.now() - started) / 1000
  await browser.close()

  // The frames came at their own pace: play them back at the same rate. Pixels and text stay
  // crisp with a fixed palette.
  const rate = (frames / seconds).toFixed(2)
  const palette =
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    rate,
    '-i',
    join(framesDir, 'frame-%04d.jpg'),
    '-vf',
    palette,
    '-loop',
    '0',
    `${out}/office.gif`,
  ])
  console.log(`${frames} frames in ${seconds.toFixed(1)} s`)
  rmSync(framesDir, { recursive: true, force: true })
  console.log(`Saved ${out}/building.png, ${out}/office.png and ${out}/office.gif`)
} finally {
  server.kill()
  rmSync(home, { recursive: true, force: true })
}
