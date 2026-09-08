/**
 * Everything the server reads from the environment, in one place.
 *
 * Two sources, either or both:
 *   ALLDASH_WORKSPACE_FILE  path to an export of the browser app (Settings → Your data → Export)
 *   ALLDASH_API_URL         the platform API, plus ALLDASH_API_KEY
 *
 * Transport:
 *   MCP_TRANSPORT           "stdio" (default, for Claude Desktop, Claude Code, VS Code) or "http"
 *   MCP_PORT / MCP_PATH     for http, default 8080 and /mcp
 *   MCP_AUTH_TOKEN          for http: required "Authorization: Bearer <token>" on every MCP request
 */
export function readConfig(env = process.env) {
  const workspaceFile = clean(env.ALLDASH_WORKSPACE_FILE)
  const apiUrl = clean(env.ALLDASH_API_URL)
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
