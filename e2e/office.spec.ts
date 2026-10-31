import { expect, test } from '@playwright/test'

test('the building lists every live office', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.live')).toHaveText(/Live/)
  const rows = page.locator('.office-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'shop' })).toHaveCount(1)
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
  await expect(page.locator('.office-row')).toHaveCount(3)
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
  await page.locator('.go').click()
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
