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
  await expect(page.locator('.chat .chat-foot')).toContainText('It runs in a terminal')
})
