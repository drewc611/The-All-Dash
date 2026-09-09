/**
 * Everything the server reads from the environment, in one place.
 *
 * Two sources, either or both:
 *   ALLDASH_WORKSPACE_FILE  path to an export of the browser app (Settings → Your data → Export);
 *                           when nothing at all is configured, ~/.all-dash/workspace.json is used if it exists
 *   ALLDASH_API_URL         the platform API, plus ALLDASH_API_KEY
 *
 * Transport:
 *   MCP_TRANSPORT           "stdio" (default, for Claude Desktop, Claude Code, VS Code) or "http"
 *   MCP_PORT / MCP_PATH     for http, default 8080 and /mcp
 *   MCP_AUTH_TOKEN          for http: required "Authorization: Bearer <token>" on every MCP request
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_WORKSPACE = '~/.all-dash/workspace.json'

export function readConfig(env = process.env, exists = existsSync) {
  const apiUrl = clean(env.ALLDASH_API_URL)
  let workspaceFile = clean(env.ALLDASH_WORKSPACE_FILE)
  if (!workspaceFile && !apiUrl) {
    // Nothing configured (the plugin's first run): use the export the user
    // saved at the default path, if there is one.
    const home = clean(env.HOME) || clean(env.USERPROFILE)
    const candidate = home ? join(home, '.all-dash', 'workspace.json') : ''
    if (candidate && exists(candidate)) workspaceFile = candidate
  }
  return {
    workspaceFile,
    apiUrl: apiUrl ? apiUrl.replace(/\/+$/, '') : '',
    apiKey: clean(env.ALLDASH_API_KEY),
    transport: (clean(env.MCP_TRANSPORT) || 'stdio').toLowerCase(),
    port: Number(env.MCP_PORT) || 8080,
    path: clean(env.MCP_PATH) || '/mcp',
    authToken: clean(env.MCP_AUTH_TOKEN),
    publicUrl: clean(env.MCP_PUBLIC_URL) || '',
  }
}

/** Env values written as "${VAR}" by a config file the host did not expand are not values. */
const clean = (v) => {
  const s = String(v ?? '').trim()
  return /^\$\{[A-Z0-9_]+\}$/i.test(s) ? '' : s
}
