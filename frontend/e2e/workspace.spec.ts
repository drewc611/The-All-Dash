import { expect, test, type Page } from '@playwright/test'

import { addTask, api, day, reset, taskByTitle } from './support/stack'

/*
 * The workspace that was here before the queue: the checklist, the context
 * switch, the brief. It had no tests at all, so the first job of this file is to
 * pin what it does today. The second is the failure that only shows in a real
 * browser: a page that renders on the server and never hydrates, where every
 * assertion about its text passes and every button is dead.
 */

test.beforeEach(reset)

const checklist = (page: Page) => page.getByRole('region', { name: 'Daily tasks' })

test('the three columns render, and the audit chain reports itself verified', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project pipelines' })).toBeVisible()
  await expect(checklist(page)).toBeVisible()
  await expect(page.getByRole('region', { name: 'AI audit log' })).toBeVisible()
  await expect(page.getByText(/Chain intact · \d+/)).toBeVisible()
})

test('the page hydrates: a control that needs React actually responds', async ({ page }) => {
  // The failure this guards against: the server sends correct HTML, the client
  // bundle never runs, and the page looks perfect while nothing works. Reading
  // text cannot tell the difference. A control that only works with JavaScript
  // can.
  await page.goto('/')
  const filter = page.getByRole('group', { name: 'Priority filter' })
  await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await filter.getByRole('button', { name: 'P1' }).click()
  await expect(filter.getByRole('button', { name: 'P1' })).toHaveAttribute('aria-pressed', 'true')
  await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
})

test('a task added from the box lands on the checklist and survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('New task').fill('Book the venue')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(checklist(page).getByText('Book the venue')).toBeVisible()
  await expect(page.getByLabel('New task')).toHaveValue('')

  await page.reload()
  await expect(checklist(page).getByText('Book the venue')).toBeVisible()

  // And it really is on the server, with the defaults the box promises.
  const stored = await taskByTitle('Book the venue')
  expect(stored).toMatchObject({ priority: 'P2', status: 'open', context: 'personal', due_date: day(0) })
})

test('the Add button waits for something to add', async ({ page }) => {
  await page.goto('/')
  const add = page.getByRole('button', { name: 'Add', exact: true })
  await expect(add).toBeDisabled()
  await page.getByLabel('New task').fill('   ')
  await expect(add).toBeDisabled()
  await page.getByLabel('New task').fill('Something real')
  await expect(add).toBeEnabled()
})

test('ticking a task marks it done on the server, and unticking reopens it', async ({ page }) => {
  await addTask({ title: 'Send the invoice', due_date: day(0) })
  await page.goto('/')

  await page.getByRole('button', { name: 'Mark "Send the invoice" done' }).click()
  await expect(page.getByRole('button', { name: 'Mark "Send the invoice" open' })).toBeVisible()
  await expect.poll(async () => (await taskByTitle('Send the invoice')).status).toBe('done')

  await page.getByRole('button', { name: 'Mark "Send the invoice" open' }).click()
  await expect(page.getByRole('button', { name: 'Mark "Send the invoice" done' })).toBeVisible()
  await expect.poll(async () => (await taskByTitle('Send the invoice')).status).toBe('open')
})

test('a tick that the server refuses rolls back and says so', async ({ page }) => {
  await addTask({ title: 'Send the invoice', due_date: day(0) })
  await page.route('**/api/tasks/*/toggle', (route) => route.fulfill({ status: 500, json: { detail: 'boom' } }))
  await page.goto('/')

  await page.getByRole('button', { name: 'Mark "Send the invoice" done' }).click()

  await expect(checklist(page)).toContainText('Could not update "Send the invoice" (500)')
  // Optimistic UI must not leave a lie behind: it is open on the server, so
  // it has to be open on the screen.
  await expect(page.getByRole('button', { name: 'Mark "Send the invoice" done' })).toBeVisible()
  expect((await taskByTitle('Send the invoice')).status).toBe('open')
})

test('overdue work says it is overdue, and today\'s work does not', async ({ page }) => {
  await addTask({ title: 'Late thing', due_date: day(-2) })
  await addTask({ title: 'Today thing', due_date: day(0) })
  await page.goto('/')

  const late = checklist(page).getByRole('listitem').filter({ hasText: 'Late thing' })
  const today = checklist(page).getByRole('listitem').filter({ hasText: 'Today thing' })
  await expect(late).toContainText('Overdue')
  await expect(today).toContainText('Due')
  await expect(today).not.toContainText('Overdue')
})

test('the context switch narrows the checklist to work or personal', async ({ page }) => {
  await addTask({ title: 'Work item', context: 'work', due_date: day(0) })
  await addTask({ title: 'Home item', context: 'personal', due_date: day(0) })
  await page.goto('/')
  await expect(checklist(page)).toContainText('Work item')
  await expect(checklist(page)).toContainText('Home item')

  const nav = page.getByRole('navigation', { name: 'Context' })
  await nav.getByRole('link', { name: 'Work' }).click()
  await expect(nav.getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page')
  await expect(checklist(page)).toContainText('Work item')
  await expect(checklist(page)).not.toContainText('Home item')

  await nav.getByRole('link', { name: 'Personal' }).click()
  await expect(checklist(page)).toContainText('Home item')
  await expect(checklist(page)).not.toContainText('Work item')
})

test('the priority filter shows only that priority', async ({ page }) => {
  await addTask({ title: 'Urgent one', priority: 'P1', due_date: day(0) })
  await addTask({ title: 'Someday one', priority: 'P3', due_date: day(0) })
  await page.goto('/')

  await page.getByRole('group', { name: 'Priority filter' }).getByRole('button', { name: 'P1' }).click()
  await expect(checklist(page)).toContainText('Urgent one')
  await expect(checklist(page)).not.toContainText('Someday one')
})

test('rebuilding the brief writes one and the header says so', async ({ page }) => {
  // No assumption about whether a brief exists yet: a retry after a failure
  // would find the one the first attempt built, and this should pass either way.
  await page.goto('/')

  await page.getByRole('button', { name: 'Rebuild the brief' }).click()

  await expect(page.getByText(/Brief built .* by api/)).toBeVisible()
  const brief = await api<{ triggered_by: string }>('GET', '/daily/latest')
  expect(brief.triggered_by).toBe('api')
})

test('a refused write is reported and adds nothing to the checklist', async ({ page }) => {
  // Only the browser's own request is intercepted; the page itself is the real
  // server render. What is checked is the client's handling of a write the
  // server would not take: it must say so, and it must not show the task.
  await page.route('**/api/tasks', (route) => route.fulfill({ status: 502, json: { detail: 'unreachable' } }))
  await page.goto('/')
  await page.getByLabel('New task').fill('Will not save')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(checklist(page)).toContainText('Could not add the task (502)')
  await expect(checklist(page).getByText('Will not save')).toHaveCount(0)
})
