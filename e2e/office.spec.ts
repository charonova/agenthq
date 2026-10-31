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
  // Claude Code says it's waiting, and for what.
  await expect(page.locator('.details')).toContainText('Waiting for you: permission prompt')
  await expect(page.locator('.details')).toContainText('Claude Codewaiting · permission prompt')
  await expect(page).toHaveTitle(/^\(\d+\) AgentHQ$/)
})

test('a timeline of what an agent did, and the alerts menu', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'qa' }).click()
  await expect(page.locator('.timeline li')).toContainText(['Run the export tests'])
  // The bell opens the alerts in the settings.
  await page.locator('.bell').click()
  const alerts = page.locator('.settings #settings-alerts')
  await expect(alerts).toContainText('Notify me when an agent needs me')
  await alerts.locator('label', { hasText: 'Also when a session finishes' }).click()
  await expect(alerts.locator('label', { hasText: 'Also when a session finishes' }).locator('input')).toBeChecked()
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

test('going to a Codex session copies `codex resume` when it can’t be opened', async ({ request }) => {
  const asked = await request.post('/api/jump', { data: { sessionId: 'codex-mobile' }, headers: { 'X-AgentHQ': '1' } })
  expect(await asked.json()).toMatchObject({ done: 'copy', command: "cd '/Users/alex/Code/mobile' && codex resume codex-mobile" })
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
  await expect(page.locator('.office-head p').first()).toContainText('Sign in with Apple')
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

test('settings: day and night, motion, hidden offices and someone’s look, kept in the browser', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  await page.locator('.gear').click()
  const settings = page.locator('.settings')
  await settings.getByRole('radio', { name: 'Always night' }).click()
  await settings.getByRole('radio', { name: 'Fast' }).click()
  await settings.getByRole('radio', { name: 'Reduced' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  await expect(settings).toContainText('Reduced now')
  await page.screenshot({ path: 'test-results/settings.png' })

  // Hide the blog's office: it leaves the building, and comes back.
  await settings.locator('#settings-offices label', { hasText: 'blog' }).click()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await page.locator('.back').click()
  await expect(page.locator('.office-row', { hasText: 'shop' })).toBeVisible()
  await expect(page.locator('.office-row', { hasText: 'blog' })).toHaveCount(0)

  // Choose how qa looks.
  await page.locator('.office-row', { hasText: 'shop' }).click()
  await page.locator('.person', { hasText: 'qa' }).click()
  await page.locator('.go.look').click()
  await page.locator('.look-editor').getByRole('radio', { name: 'Woman' }).click()
  await page.locator('.look-editor').getByRole('radio', { name: 'Skin #a8714a' }).click()
  await expect(page.locator('.look-editor').getByRole('radio', { name: 'Woman' })).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'test-results/look.png' })

  // Everything is still so after a reload.
  await page.reload()
  await page.locator('.gear').click()
  await expect(settings.getByRole('radio', { name: 'Always night' })).toHaveAttribute('aria-checked', 'true')
  await expect(settings.locator('.looks')).toContainText('staff · qa')
  await settings.locator('.looks li', { hasText: 'qa' }).locator('.btn').click()
  await settings.locator('.btn', { hasText: 'Show every office' }).click()
  await settings.getByRole('radio', { name: 'Like my computer' }).click()
  await page.keyboard.press('Escape')
  await page.goto('/')
  await expect(page.locator('.office-row', { hasText: 'blog' })).toBeVisible()
})

test('the keyboard alone: Tab and Enter into an office, a person and their conversation; Esc back out', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.office-row', { hasText: 'shop' })).toBeVisible()
  await page.locator('.office-row', { hasText: 'shop' }).focus()
  await page.keyboard.press('Enter')
  // In the office, the keyboard is on its people.
  await expect(page.locator('.office-head')).toContainText('shop')
  await expect(page.locator('.person').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('.details')).toBeVisible()
  const selected = await page.locator('.person[aria-pressed="true"]').getAttribute('data-agent')
  await page.locator('.chat-open').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.chat')).toBeVisible()
  await expect(page.locator('.chat-search input')).toBeFocused()
  await page.screenshot({ path: 'test-results/keyboard.png' })

  // Esc steps back: the conversation, the person, the office.
  await page.keyboard.press('Escape')
  await expect(page.locator('.chat')).toHaveCount(0)
  await expect(page.locator(`.person[data-agent="${selected}"]`)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.details')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.office-row', { hasText: 'shop' })).toBeFocused()

  // The settings too.
  await page.locator('.gear').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.settings')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings')).toHaveCount(0)
  await expect(page.locator('.gear')).toBeFocused()
})

test('who talked to whom, and the team’s tasks', async ({ page }) => {
  await page.goto('/#/office/session-shop')
  const talks = page.locator('.insight .talks')
  await expect(talks).toContainText('ui → api')
  await expect(talks).toContainText('qa → Manager')
  const tasks = page.locator('.insight .tasks')
  await expect(tasks).toContainText('1 of 4 done')
  await expect(tasks.locator('li.in_progress', { hasText: 'Test the export' })).toContainText('waits on #1')
  // Tokens for the office, and for one of them.
  await expect(page.locator('.office-head .tokens')).toContainText(/\d+(\.\d)?k in · \d+(\.\d)?k out/)
  await page.locator('.person', { hasText: 'qa' }).click()
  await expect(page.locator('.details')).toContainText('Tokens')
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/insight.png' })
})

test('a Codex thread’s tokens, from Codex’s own running total', async ({ page }) => {
  await page.goto('/#/office/codex-mobile')
  await expect(page.locator('.office-head .tokens')).toContainText('182k in · 9.4k out')
})

test('find an agent by a file it touched, and everyone waiting', async ({ page }) => {
  await page.goto('/')
  await page.locator('.stage').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('/')
  const find = page.locator('.find input')
  await expect(find).toBeFocused()
  await find.fill('export.ts')
  const results = page.locator('.find-results')
  await expect(results.locator('li').first()).toContainText('api')
  await expect(results.locator('li').first()).toContainText('export.ts')
  await page.screenshot({ path: 'test-results/find.png' })
  await find.press('Enter')
  await expect(page.locator('.office-head')).toContainText('shop')
  await expect(page.locator('.details')).toContainText('api')

  await find.fill('')
  await find.focus()
  await results.getByRole('radio', { name: '✋ Waiting' }).click()
  await expect(results.locator('li')).toHaveCount(1)
  await expect(results.locator('li')).toContainText('blog')
})
