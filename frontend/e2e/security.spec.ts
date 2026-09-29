import { expect, test } from '@playwright/test'

import { API_KEY, AUTH, GUARDED_URL } from './support/env'

/*
 * The proxy, tested as a deployment sees it: a second copy of the same build
 * with authentication switched on. proxy.ts is the only thing between the
 * internet and an API key with write access to the finance ledger, and none of
 * what it does is visible from a page that was loaded by someone already in.
 */

test.use({ baseURL: GUARDED_URL })

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
const good = { authorization: basic(AUTH.user, AUTH.password) }

test('a request with no credentials is challenged, not served', async ({ request }) => {
  const res = await request.get('/')
  expect(res.status()).toBe(401)
  expect(res.headers()['www-authenticate']).toMatch(/^Basic realm=/)
  // Nothing of the workspace leaks into the refusal.
  expect(await res.text()).not.toMatch(/Workspace|Daily tasks|Proposed changes/)
})

test('a wrong password is refused, and so is a wrong user', async ({ request }) => {
  expect((await request.get('/', { headers: { authorization: basic(AUTH.user, 'nope') } })).status()).toBe(401)
  expect((await request.get('/', { headers: { authorization: basic('someone', AUTH.password) } })).status()).toBe(401)
  expect((await request.get('/', { headers: { authorization: 'Bearer abc' } })).status()).toBe(401)
})

test('the API routes are behind the same door', async ({ request }) => {
  // The route handlers hold the API key, so reaching one unauthenticated would
  // be worth more than reaching the page.
  for (const path of ['/api/tasks', '/api/daily', '/api/proposals/x/apply']) {
    const res = await request.post(path, { data: {} })
    expect(res.status(), path).toBe(401)
  }
})

test('the right credentials get the workspace', async ({ browser }) => {
  const context = await browser.newContext({ httpCredentials: { username: AUTH.user, password: AUTH.password }, baseURL: GUARDED_URL })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible()
  await context.close()
})

test('the health probes stay open so the kubelet can reach them', async ({ request }) => {
  expect((await request.get('/api/healthz')).status()).toBe(200)
  // Readiness reports the backend, and the backend is up for these specs.
  expect((await request.get('/api/readyz')).status()).toBe(200)
})

test('a cross-site write is refused even with valid credentials', async ({ request }) => {
  const res = await request.post('/api/tasks', {
    headers: { ...good, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    data: { title: 'forged', due_date: '2026-01-01' },
  })
  expect(res.status()).toBe(403)
  expect(await res.json()).toEqual({ detail: 'Cross-site request refused' })
})

test('a cross-site write is refused when the browser only sends an Origin', async ({ request }) => {
  const res = await request.post('/api/tasks', {
    headers: { ...good, origin: 'https://evil.example', 'content-type': 'application/json' },
    data: { title: 'forged', due_date: '2026-01-01' },
  })
  expect(res.status()).toBe(403)
})

test('a same-origin write gets past the proxy to the route, which validates it', async ({ request }) => {
  const res = await request.post('/api/tasks', {
    headers: { ...good, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    data: { title: 'no date' },
  })
  // 422 is the route's own validation. If the proxy had refused it this would
  // be 403, so this proves the door opens for the right caller and not just that
  // it shuts for the wrong one.
  expect(res.status()).toBe(422)
})

test('the mutating routes accept POST and nothing else', async ({ request }) => {
  for (const path of ['/api/proposals/x/apply', '/api/proposals/x/decline', '/api/tasks/x/toggle']) {
    expect((await request.get(path, { headers: good })).status(), `GET ${path}`).toBe(405)
  }
})

test('the API key never reaches the browser', async ({ request }) => {
  const html = await (await request.get('/', { headers: good })).text()
  expect(html).not.toContain(API_KEY)

  // Every script the page loads, not only the document.
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []))
  expect(scripts.length).toBeGreaterThan(0)
  for (const src of scripts) {
    const body = await (await request.get(src, { headers: good })).text()
    expect(body, src).not.toContain(API_KEY)
  }
})

test('the content security policy carries a fresh nonce and allows no eval', async ({ request }) => {
  const a = (await request.get('/', { headers: good })).headers()['content-security-policy'] ?? ''
  const b = (await request.get('/', { headers: good })).headers()['content-security-policy'] ?? ''
  expect(a, 'no CSP header on the response').not.toBe('')
  expect(a).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/)
  expect(a).not.toContain('unsafe-eval')
  expect(a).toContain("frame-ancestors 'none'")
  expect(a).toContain("object-src 'none'")
  // Per request: a nonce that repeats is a nonce that can be replayed.
  expect(a.match(/nonce-([^']+)/)?.[1]).not.toBe(b.match(/nonce-([^']+)/)?.[1])
})
