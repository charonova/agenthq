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
