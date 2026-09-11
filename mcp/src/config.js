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
 *   MCP_AUTH_TOKEN          for http: required "Authorization: Bearer <token>" on every MCP request.
 *                           HTTP mode refuses to start without it unless MCP_ALLOW_UNAUTHENTICATED=true,
 *                           and then binds to the loopback interface only
 *   MCP_HOST                for http: interface to bind (default 0.0.0.0 with a token, 127.0.0.1 without)
 *   MCP_ALLOWED_HOSTS       for http: comma-separated Host header names accepted on the MCP path
 *                           (DNS-rebinding protection; default: localhost names when unauthenticated)
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
    allowUnauthenticated: clean(env.MCP_ALLOW_UNAUTHENTICATED).toLowerCase() === 'true',
    host: clean(env.MCP_HOST),
    allowedHosts: list(env.MCP_ALLOWED_HOSTS),
    // Only the first of a comma-separated list, and only when set: without it
    // citations use the alldash:// scheme rather than a URL that 404s.
    publicUrl: clean(env.MCP_PUBLIC_URL).split(',')[0].trim(),
  }
}

const list = (v) => clean(v).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

/** Env values written as "${VAR}" by a config file the host did not expand are not values. */
const clean = (v) => {
  const s = String(v ?? '').trim()
  return /^\$\{[A-Z0-9_]+(:-[^}]*)?\}$/i.test(s) ? '' : s
}
