import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Where the stack under test lives. Shared by the config, which starts it, and
 * the specs, which talk to it, so the two cannot disagree about a port.
 */

export const FRONTEND_DIR = resolve(__dirname, '..', '..')
export const BACKEND_DIR = resolve(FRONTEND_DIR, '..', 'backend')
export const STATE_DIR = join(FRONTEND_DIR, 'e2e', '.state')

export const PORTS = { backend: 8710, open: 3710, guarded: 3711 } as const
export const API_KEY = 'e2e-key'
export const AUTH = { user: 'e2e-user', password: 'e2e-password' } as const

export const API_URL = `http://127.0.0.1:${PORTS.backend}`
export const OPEN_URL = `http://127.0.0.1:${PORTS.open}`
export const GUARDED_URL = `http://127.0.0.1:${PORTS.guarded}`

/** The venv when there is one (local), otherwise whatever `python` CI installed into. */
export const PYTHON =
  process.env.E2E_PYTHON ??
  (existsSync(join(BACKEND_DIR, '.venv', 'bin', 'python')) ? join(BACKEND_DIR, '.venv', 'bin', 'python') : 'python')

export const BACKEND_ENV = {
  ALLDASH_DATABASE_URL: `sqlite+aiosqlite:///${join(STATE_DIR, 'e2e.db')}`,
  ALLDASH_API_KEYS: API_KEY,
  ALLDASH_ENVIRONMENT: 'test',
  // Nothing listens here and nothing should: the worker is not part of the
  // stack under test. Its scan is run directly by e2e/support/scan.py.
  ALLDASH_REDIS_URL: 'redis://127.0.0.1:1/0',
}
