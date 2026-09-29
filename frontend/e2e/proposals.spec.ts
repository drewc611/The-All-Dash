import { expect, test } from '@playwright/test'

import { api, LATE, proposals, reset, scan, seedLate, taskByTitle } from './support/stack'

/*
 * The morning queue: what the worker filed overnight, waiting on a person.
 *
 * These drive the real backend and the production frontend, and check the
 * outcome against the server as well as the page. The claim being tested is not
 * "a button exists". It is that nothing is applied without a decision, that a
 * proposal the task has moved past refuses itself, and that what the screen says
 * happened is what the database says happened.
 */

test.beforeEach(async () => {
  await reset()
  await seedLate()
  // Three tasks past their date and not started: three proposals.
  expect(scan()).toHaveLength(3)
})

const queue = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Proposed changes' })
const checklist = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Daily tasks' })
const applyName = (title: string, from = 'P3', to = 'P2') => `Apply: priority of "${title}" from ${from} to ${to}`
const declineName = (title: string, from = 'P3', to = 'P2') => `Decline: priority of "${title}" from ${from} to ${to}`

test('the queue shows what the worker filed, with reasons, and applies nothing', async ({ page }) => {
  await page.goto('/')
  await expect(queue(page)).toContainText('3 waiting on you · nothing applied')
  for (const title of Object.values(LATE)) await expect(queue(page)).toContainText(title)
  await expect(queue(page).getByText(/Due \d+ days? ago and still not started/)).toHaveCount(3)

  // No way to approve in bulk, anywhere on the page.
  await expect(page.getByRole('button', { name: /apply all|approve all|accept all/i })).toHaveCount(0)

  // Filing a proposal changed nothing. The suggestion is not the edit.
  for (const t of Object.values(LATE)) expect((await taskByTitle(t)).priority).toBe('P3')
})

test('buttons are named for what they do, not for the word on them', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: applyName(LATE.cert) })).toBeVisible()
  await expect(page.getByRole('button', { name: declineName(LATE.cert) })).toBeVisible()
  // Three rows, three identical "Apply" words, and every one distinguishable
  // from a list of controls.
  await expect(queue(page).getByRole('button', { name: /^Apply: / })).toHaveCount(3)
})

test('applying reports what the task reads back, and the checklist follows without a reload', async ({ page }) => {
  await page.goto('/')
  await expect(checklist(page).getByRole('listitem').filter({ hasText: LATE.cert })).toContainText('P3')

  await page.getByRole('button', { name: applyName(LATE.cert) }).click()

  // The outcome names what the row now says, not that a write was sent.
  await expect(queue(page)).toContainText('Applied. The task now reads P2.')
  // The checklist is server-rendered and keeps its own copy, so this only
  // passes if the page was refreshed and the list remounted.
  await expect(checklist(page).getByRole('listitem').filter({ hasText: LATE.cert })).toContainText('P2')

  const task = await taskByTitle(LATE.cert)
  expect(task.priority).toBe('P2')
  // The other two were not touched by deciding the first.
  expect((await taskByTitle(LATE.key)).priority).toBe('P3')
  const decided = (await proposals('applied')).find((p) => p.task_id === task.id)
  expect(decided?.observed).toBe('P2')
})

test('a proposal the task overtook is refused, and the newer value survives', async ({ page }) => {
  await page.goto('/')
  // The page has already loaded, so the button is enabled and nothing on screen
  // knows yet. Somebody else changes the task in the meantime.
  const task = await taskByTitle(LATE.key)
  await api('PATCH', `/tasks/${task.id}`, { priority: 'P1' })

  await page.getByRole('button', { name: applyName(LATE.key) }).click()

  await expect(queue(page)).toContainText('Not applied: the task changed after this was proposed - it now reads P1')
  // The point of the whole design: the newer decision was not overwritten.
  expect((await taskByTitle(LATE.key)).priority).toBe('P1')
})

test('a proposal that is already stale when the page loads says so before anyone clicks', async ({ page }) => {
  const task = await taskByTitle(LATE.key)
  await api('PATCH', `/tasks/${task.id}`, { priority: 'P1' })
  await page.goto('/')

  const apply = page.getByRole('button', { name: applyName(LATE.key) })
  await expect(apply).toBeDisabled()
  await expect(queue(page)).toContainText('Cannot apply: the task changed after this was proposed - it now reads P1')

  // The reason is attached to the button, so a screen reader hears why it is off.
  const describedBy = await apply.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText('Cannot apply')

  // Saying no is still possible on a row that can no longer be applied.
  await expect(page.getByRole('button', { name: declineName(LATE.key) })).toBeEnabled()
})

test('a task that already says what was proposed is reported as done, not as changed', async ({ page }) => {
  const task = await taskByTitle(LATE.faq)
  await api('PATCH', `/tasks/${task.id}`, { priority: 'P2' })
  await page.goto('/')
  await expect(queue(page)).toContainText('Cannot apply: the task already says that')
})

test('declining is remembered: the same question is not asked again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: declineName(LATE.faq) }).click()
  await expect(queue(page)).toContainText('Declined. It will not be proposed again.')

  // The worker runs again the next night. It must not re-raise what was refused.
  expect(scan()).toEqual([])

  await page.reload()
  await expect(queue(page)).toContainText('2 waiting on you')
  await expect(queue(page)).not.toContainText(LATE.faq)
  expect((await taskByTitle(LATE.faq)).priority).toBe('P3')
})

test('once everything is decided the queue is gone rather than empty', async ({ page }) => {
  await page.goto('/')
  for (const title of Object.values(LATE)) {
    await page.getByRole('button', { name: declineName(title) }).click()
    await expect(queue(page)).toContainText('Declined')
  }
  await page.reload()
  await expect(queue(page)).toHaveCount(0)
  // The rest of the workspace is still there.
  await expect(checklist(page)).toBeVisible()
})

test('a failed request says so and leaves the row waiting, not half-done', async ({ page }) => {
  await page.route('**/api/proposals/*/apply', (route) => route.fulfill({ status: 502, json: { detail: 'upstream down' } }))
  await page.goto('/')

  await page.getByRole('button', { name: applyName(LATE.cert) }).click()

  await expect(queue(page)).toContainText(`Could not apply "${LATE.cert}" (502)`)
  // Still pending, still actionable, and the task was not touched.
  await expect(page.getByRole('button', { name: applyName(LATE.cert) })).toBeEnabled()
  expect((await taskByTitle(LATE.cert)).priority).toBe('P3')
})

test('every decision lands in the audit ledger, and the chain still verifies', async ({ page }) => {
  const before = (await api<{ items: unknown[]; total: number }>('GET', '/ai-audit-logs?limit=1')).total
  await page.goto('/')
  await page.getByRole('button', { name: applyName(LATE.cert) }).click()
  await expect(queue(page)).toContainText('Applied.')
  await page.getByRole('button', { name: declineName(LATE.faq) }).click()
  await expect(queue(page)).toContainText('Declined.')

  const ledger = await api<{ items: Array<{ action: string; subject_id: string; confidence: number }>; total: number }>(
    'GET',
    '/ai-audit-logs?limit=10',
  )
  expect(ledger.total).toBe(before + 2)
  const cert = await taskByTitle(LATE.cert)
  const applied = ledger.items.find((e) => e.action === 'proposal_applied')
  expect(applied?.subject_id).toBe(cert.id)
  // Confirmed by reading the row back, so full confidence. A refusal is 0.5.
  expect(applied?.confidence).toBe(1)
  expect(ledger.items.some((e) => e.action === 'proposal_not_applied')).toBe(true)

  const chain = await api<{ ok: boolean }>('GET', '/ai-audit-logs/verify')
  expect(chain.ok).toBe(true)
  // And the workspace agrees with the server about it.
  await page.reload()
  await expect(page.getByText(/Chain intact · \d+/)).toBeVisible()
})
