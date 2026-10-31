import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// Sessions started from AgentHQ run a stand-in agent here (e2e/fake-agent.mjs), never real Claude Code.
const project = join(tmpdir(), 'agenthq-e2e-project-4799')

test('start a session from AgentHQ, answer its prompt, message it, end it and resume it', async ({ page }) => {
  await page.goto('/')
  await page.locator('.new-session').click()
  const dialog = page.locator('.dialog')
  await dialog.locator('input').fill(project)
  await dialog.locator('textarea').fill('Please deploy the site')
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/new-session.png' })
  await dialog.locator('.btn', { hasText: 'Start' }).click()

  // Its conversation opens on its own once the office appears, with its prompt waiting.
  const chat = page.locator('.chat')
  await expect(chat.locator('.msg.user')).toContainText('Please deploy the site', { timeout: 15_000 })
  const card = chat.locator('.ask')
  await expect(card).toContainText('npm run deploy')
  await card.locator('.btn', { hasText: 'Allow once' }).click()
  await expect(chat.locator('.msg.assistant').last()).toContainText('Deployed.')
  await expect(page.locator('.office-head')).toContainText('agenthq-e2e-project-4799')
  await expect(page.locator('.details')).not.toContainText('ended')

  const box = chat.locator('.composer textarea')
  await box.fill('thanks')
  await box.press('Enter')
  await expect(chat.locator('.msg.assistant').last()).toContainText('You said: thanks')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/session-chat.png' })

  await chat.locator('.composer').getByRole('button', { name: 'End', exact: true }).click()
  await expect(chat.locator('.composer .btn.primary')).toHaveText('Resume here', { timeout: 10_000 })
  await box.fill('one more')
  await chat.locator('.composer .btn.primary').click()
  await expect(chat.locator('.msg.assistant').last()).toContainText('You said: one more')
  await expect(chat.locator('.composer .btn.primary')).toHaveText('Send')
})

test('a reply streams in as it’s written, then its transcript line takes over', async ({ page }) => {
  await page.goto('/')
  await page.locator('.new-session').click()
  await page.locator('.dialog input').fill(project)
  await page.locator('.dialog textarea').fill('Tell me a story, slowly')
  await page.locator('.dialog .btn', { hasText: 'Start' }).click()
  const chat = page.locator('.chat')
  const draft = chat.locator('.msg.draft')
  await expect(draft).toContainText('Once upon', { timeout: 15_000 })
  await expect(draft).toContainText('writing…')
  // Still being written: the transcript doesn't have it yet.
  await expect(chat.locator('.msg.assistant:not(.draft)')).toHaveCount(0)
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'test-results/streaming.png' })
  await expect(chat.locator('.msg.assistant:not(.draft)').last()).toContainText('worked through the night.', { timeout: 15_000 })
  await expect(draft).toHaveCount(0)
  await chat.locator('.composer').getByRole('button', { name: 'End', exact: true }).click()
})

test('a session can’t start in a folder that doesn’t exist, and the endpoints are the page’s only', async ({ page, request }) => {
  expect((await request.post('/api/sessions/start', { data: { cwd: project, text: 'hi' } })).status()).toBe(403)
  await page.goto('/')
  await page.locator('.new-session').click()
  await page.locator('.dialog input').fill('/no/such/folder')
  await page.locator('.dialog textarea').fill('hi')
  await page.locator('.dialog .btn', { hasText: 'Start' }).click()
  await expect(page.locator('.toast')).toContainText('Pick a folder that exists')
})

test('a session running in a terminal is messaged there', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.chat-open').click()
  await expect(page.locator('.chat')).toContainText('It runs in a terminal')
})

test('typing into a terminal session is off until turned on, then goes to its tab (copied here)', async ({ page, request }) => {
  const type = { sessionId: 'session-blog', text: 'hi' }
  expect((await request.post('/api/type', { data: type })).status()).toBe(403)
  expect((await request.post('/api/typing', { data: { enable: true } })).status()).toBe(403)
  await page.goto('/#/office/session-blog')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.chat-open').click()
  const chat = page.locator('.chat')
  await expect(chat.locator('.chat-foot')).toContainText('turn on typing into terminals')

  await page.locator('.bell').click()
  await page.locator('.typing .btn', { hasText: 'Turn on…' }).click()
  await expect(page.locator('.typing')).toContainText('exactly as if you typed it there')
  await page.locator('.typing .btn', { hasText: 'Turn on' }).click()
  await expect(page.locator('.typing')).toContainText('On')
  await page.locator('.bell').click()

  const box = chat.locator('.composer textarea')
  await expect(box).toHaveAttribute('placeholder', /terminal tab/)
  // Tests never type into real windows (AGENTHQ_JUMP=copy): the message is copied instead.
  await box.fill('-run the tests\nthen commit')
  await box.press('Enter')
  await expect(page.locator('.toast')).toContainText('copied your message')
  await expect(box).toHaveValue('')
  await page.screenshot({ path: 'test-results/typing.png' })

  await page.locator('.bell').click()
  await page.locator('.typing .btn', { hasText: 'Turn off' }).click()
  await expect(chat.locator('.chat-foot')).toContainText('turn on typing into terminals')
})
