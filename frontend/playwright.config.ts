import { defineConfig, devices } from '@playwright/test'

import { API_KEY, API_URL, AUTH, BACKEND_DIR, BACKEND_ENV, OPEN_URL, PORTS, PYTHON, STATE_DIR } from './e2e/support/env'

/**
 * End-to-end tests for the workspace, against the stack that ships.
 *
 * Nothing here is mocked. The backend is the real FastAPI app on a fresh SQLite
 * database built by the real migrations, and the frontend is the production
 * build. A mock of either would test the mock: the last bug this suite exists
 * to catch was a page that rendered on the server and never hydrated, and no
 * unit test sees that.
 *
 * Two frontends run off the same build. One has authentication switched off so
 * the workspace can be driven; the other has it on, so the proxy's Basic auth,
 * cross-site refusal and CSP are tested as the deployment sees them.
 */

const frontendEnv = (extra: Record<string, string>) => ({
  BACKEND_URL: API_URL,
  BACKEND_API_KEY: API_KEY,
  NEXT_TELEMETRY_DISABLED: '1',
  ...extra,
})

export default defineConfig({
  testDir: './e2e',
  // One worker, in file order. The specs share one database and one queue, and
  // each starts by resetting it; running them in parallel would have them
  // deleting each other's tasks.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: OPEN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // A fresh database every run, migrated by the real migrations, so a
      // migration that does not apply cleanly fails here and not in production.
      command: `bash -c 'rm -rf "${STATE_DIR}" && mkdir -p "${STATE_DIR}" && cd "${BACKEND_DIR}" && "${PYTHON}" -m alembic upgrade head && exec "${PYTHON}" -m uvicorn app.main:app --port ${PORTS.backend} --log-level warning'`,
      url: `http://127.0.0.1:${PORTS.backend}/healthz`,
      env: { ...BACKEND_ENV, PYTHONPATH: BACKEND_DIR },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next start -p ${PORTS.open}`,
      url: `http://127.0.0.1:${PORTS.open}/api/healthz`,
      env: frontendEnv({ FRONTEND_AUTH_DISABLED: 'true' }),
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next start -p ${PORTS.guarded}`,
      url: `http://127.0.0.1:${PORTS.guarded}/api/healthz`,
      env: frontendEnv({ FRONTEND_AUTH_USER: AUTH.user, FRONTEND_AUTH_PASSWORD: AUTH.password }),
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
