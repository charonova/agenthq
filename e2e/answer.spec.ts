import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'

// Stands in for AgentHQ's hook: hands a prompt to the server with its secret, and waits for the answer.
const server = () =>
  JSON.parse(readFileSync(join(tmpdir(), 'agenthq-e2e-state-4799', 'server.json'), 'utf8')) as { token: string }
const hook = (request: APIRequestContext, input: object) =>
  request.post('/api/hook', {
    headers: { Authorization: `Bearer ${server().token}` },
    data: { hook_event_name: 'PermissionRequest', ...input },
    timeout: 25_000,
  })

test('turning on answering from AgentHQ asks first', async ({ page }) => {
  await page.goto('/')
  await page.locator('.bell').click()
  await expect(page.locator('.answering')).toContainText('Off')
  await page.locator('.answering .btn', { hasText: 'Turn on…' }).click()
  await expect(page.locator('.answering')).toContainText('~/.claude/settings.json')
  await page.locator('.answering .btn', { hasText: 'Turn on' }).last().click()
  await expect(page.locator('.answering')).toContainText('On')
  await page.locator('.answering .btn', { hasText: 'Turn off' }).click()
  await expect(page.locator('.answering')).toContainText('Off')
})

test('the hook needs the secret', async ({ request }) => {
  const response = await request.post('/api/hook', { headers: { Authorization: 'Bearer nope' }, data: {} })
  expect(response.status()).toBe(403)
})

test('a permission prompt answered from AgentHQ', async ({ page, request }) => {
  const reply = hook(request, {
    session_id: 'session-blog',
    tool_name: 'Bash',
    tool_input: { command: 'npm run deploy', description: 'Deploy the blog' },
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run deploy:*' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  })
  await page.goto('/#/office/session-blog')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.asked').click()
  const card = page.locator('.chat .ask')
  await expect(card).toContainText('Bash needs your permission')
  await expect(card.locator('.ask-input')).toHaveText('npm run deploy')
  await expect(card.locator('.btn', { hasText: 'Always allow Bash(npm run deploy:*) in this project' })).toBeVisible()
  await page.waitForTimeout(300) // the panel slides in
  await page.screenshot({ path: 'test-results/permission.png' })
  await card.locator('.btn', { hasText: 'Allow once' }).click()
  const response = await reply
  expect(await response.json()).toEqual({ decision: { behavior: 'allow' } })
  await expect(card).toHaveCount(0)
})

test('a question answered from AgentHQ, with your own words for one of them', async ({ page, request }) => {
  const reply = hook(request, {
    session_id: 'session-shop',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'Which format?',
          header: 'Format',
          multiSelect: false,
          options: [{ label: 'CSV', description: 'Opens in Excel' }, { label: 'JSON' }],
        },
        { question: 'Which columns?', header: 'Columns', multiSelect: true, options: [{ label: 'id' }, { label: 'total' }] },
      ],
    },
  })
  await page.goto('/#/office/session-shop')
  await page.locator('.person', { hasText: 'Manager' }).click()
  await page.locator('.asked').click()
  const card = page.locator('.chat .ask')
  await expect(card).toContainText('Which format?')
  const send = card.locator('.btn', { hasText: 'Send answers' })
  await expect(send).toBeDisabled()
  await card.locator('.option', { hasText: 'CSV' }).click()
  await card.locator('.option', { hasText: 'id' }).click()
  await card.locator('.option', { hasText: 'total' }).click()
  await card.locator('.ask-other').nth(1).fill('date')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/question.png' })
  await send.click()
  const { decision } = (await (await reply).json()) as { decision: { behavior: string; updatedInput: { answers: object } } }
  expect(decision.behavior).toBe('allow')
  expect(decision.updatedInput.answers).toEqual({ 'Which format?': 'CSV', 'Which columns?': 'id, total, date' })
})
