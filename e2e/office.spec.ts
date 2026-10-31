import { expect, test } from '@playwright/test'

test('the building lists every live office', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live')).toHaveText(/Live/)
  const rows = page.locator('.office-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.filter({ hasText: 'shop' })).toHaveCount(1)
  await expect(rows.filter({ hasText: 'mobile' })).toContainText('codex')
  await expect(page.locator('.world canvas')).toBeVisible()
  await page.screenshot({ path: 'test-results/building.png' })
})

test('an office shows its manager, staff and interns, with details on click', async ({ page }) => {
  await page.goto('/')
  await page.locator('.office-row', { hasText: 'shop' }).click()
  await expect(page).toHaveURL(/#\/office\/session-shop$/)
  await expect(page.locator('.office-head h2')).toHaveText('shop')
  const people = page.locator('.person')
  await expect(people.filter({ hasText: 'Manager' })).toHaveCount(1)
  await expect(people.filter({ hasText: 'qa' })).toContainText('Run the export tests')
  await expect(people.filter({ hasText: 'Find a CSV streaming library' })).toContainText('intern')
  await expect(people.filter({ hasText: 'data' })).toContainText('On the couch')

  await people.filter({ hasText: 'api' }).first().click()
  await expect(page.locator('.details')).toContainText('export.ts')
  await page.waitForTimeout(800) // the camera's zoom
  await page.screenshot({ path: 'test-results/office.png' })

  await page.locator('.back').click()
  await expect(page).toHaveURL(/#\/$/)
})

test('the "need you" counter goes to whoever is waiting', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.office-row')).toHaveCount(4)
  // The made-up blog session's manager waits on a command it ran.
  await page.locator('.chip-button').click()
  await expect(page).toHaveURL(/#\/office\/session-blog$/)
  await expect(page.locator('.details')).toContainText('Waiting for you')
  // Claude Code says it's idle with a tool call unanswered: a permission prompt.
  await expect(page.locator('.details')).toContainText('Claude Codeidle')
  await expect(page).toHaveTitle(/^\(\d+\) AgentHQ$/)
})

test('a timeline of what an agent did, and the alerts menu', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'qa' }).click()
  await expect(page.locator('.timeline li')).toContainText(['Run the export tests'])
  await page.locator('.bell').click()
  await expect(page.locator('.alerts .menu')).toContainText('Notify me when an agent needs me')
  await page.locator('.alerts label', { hasText: 'Also when a session finishes' }).click()
  await expect(page.locator('.alerts label', { hasText: 'Also when a session finishes' }).locator('input')).toBeChecked()
  await page.screenshot({ path: 'test-results/alerts.png' })
})

test('going to a session that can’t be opened copies the command that resumes it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'api' }).first().click()
  await page.locator('.go.jump').click()
  // The made-up sessions aren't running anywhere: the command comes instead.
  await expect(page.locator('.toast')).toContainText('claude --resume session-shop')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "cd '/Users/alex/Code/shop' && claude --resume session-shop",
  )
})

test('only the office page can ask to open a window', async ({ request }) => {
  const asked = await request.post('/api/jump', { data: { sessionId: 'session-shop' } })
  expect(asked.status()).toBe(403)
  const unknown = await request.post('/api/jump', { data: { sessionId: 'nope' }, headers: { 'X-AgentHQ': '1' } })
  expect(unknown.status()).toBe(404)
})

test('a Codex thread is an office too, with its sub-agents as staff', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.locator('.office-row', { hasText: 'mobile' }).click()
  await expect(page.locator('.office-head p')).toContainText('Sign in with Apple')
  await expect(page.locator('.person', { hasText: 'Manager' })).toContainText('Login.tsx')
  await expect(page.locator('.person', { hasText: 'guardian' })).toContainText('pnpm test')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.go.jump').click()
  await expect(page.locator('.toast')).toContainText('codex resume codex-mobile')
})

test('an agent’s whole conversation: prompts, replies, tools with their output, teammates, and search', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.chat-open').click()
  const chat = page.locator('.chat')
  await expect(chat.locator('h3')).toHaveText('Manager')
  await expect(chat.locator('.msg.user').first()).toContainText('add a CSV export')
  // Markdown becomes elements, not HTML.
  await expect(chat.locator('.msg.assistant .md .h').first()).toHaveText('Plan')
  await expect(chat.locator('.msg.assistant code').first()).toHaveText('src/export.ts')
  await expect(chat.locator('.msg.agent')).toContainText('All 12 export tests pass on main.')
  await expect(chat.locator('.msg.agent .meta')).toContainText('From qa')
  const tool = chat.locator('.tool', { hasText: 'List the sources' })
  await tool.locator('summary').click()
  await expect(tool.locator('pre.output')).toHaveText(/orders\.ts/)
  await expect(chat.locator('.chat-note')).toContainText(['The beginning of the conversation'])
  await page.screenshot({ path: 'test-results/conversation.png' })

  await chat.locator('input[type=search]').fill('tests pass')
  await expect(chat.locator('.msg')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(chat).toHaveCount(0)
})

test('the conversation endpoint answers only the office’s own page, for agents in the office', async ({ request }) => {
  const ok = await request.get('/api/conversation?session=session-shop&agent=session-shop', { headers: { 'X-AgentHQ': '1' } })
  expect(ok.status()).toBe(200)
  expect(((await ok.json()) as { messages: unknown[] }).messages.length).toBeGreaterThan(3)
  expect((await request.get('/api/conversation?session=session-shop&agent=session-shop')).status()).toBe(403)
  expect(
    (await request.get('/api/conversation?session=session-shop&agent=nobody', { headers: { 'X-AgentHQ': '1' } })).status(),
  ).toBe(404)
})

test('Codex threads have conversations too', async ({ page }) => {
  await page.goto('/#/office/codex-mobile')
  await page.locator('.person').first().click()
  await page.locator('.chat-open').click()
  await expect(page.locator('.chat .tool').first()).toContainText('rg useAuth')
})
