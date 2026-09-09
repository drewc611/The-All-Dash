#!/usr/bin/env node
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { DEFAULT_WORKSPACE, readConfig } from './config.js'
import { PlatformAdapter } from './adapters/platform.js'
import { WorkspaceAdapter } from './adapters/workspace.js'
import { registerAll } from './tools.js'

/**
 * The All Dash MCP server.
 *
 *   node src/server.js                        stdio, for Claude Desktop, Claude Code, VS Code / Copilot
 *   MCP_TRANSPORT=http node src/server.js     Streamable HTTP on :8080/mcp, for ChatGPT connectors and
 *                                             any remote client; protect it with MCP_AUTH_TOKEN
 *
 * HTTP mode is stateless: every request gets its own server and transport,
 * so the process can sit behind a load balancer with no session affinity.
 *
 * HTTP mode fails closed: without MCP_AUTH_TOKEN it refuses to start, unless
 * MCP_ALLOW_UNAUTHENTICATED=true, in which case it binds to loopback only and
 * accepts only localhost Host headers, so a web page cannot reach it through
 * DNS rebinding.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** The Host header without its port, lower-cased; "[::1]:8080" becomes "[::1]". */
export const hostName = (header) => String(header || '').trim().toLowerCase().replace(/:\d+$/, '')

export function createServer(config = readConfig()) {
  const workspace = config.workspaceFile ? new WorkspaceAdapter(config.workspaceFile) : null
  const platform = config.apiUrl ? new PlatformAdapter(config.apiUrl, config.apiKey) : null
  if (!workspace && !platform) {
    throw new Error(
      `Nothing to serve. Export your workspace from the app (Settings → Your data → Export) and save it as ${DEFAULT_WORKSPACE}, ` +
        'or set ALLDASH_WORKSPACE_FILE to the export, and/or ALLDASH_API_URL plus ALLDASH_API_KEY for the platform API.'
    )
  }
  const server = new McpServer(
    { name: 'all-dash', version: '0.1.0' },
    { instructions: instructions(workspace, platform) }
  )
  registerAll(server, { workspace, platform, publicUrl: config.publicUrl })
  return server
}

function instructions(workspace, platform) {
  const parts = ['The All Dash: a project and personal command center.']
  if (workspace) parts.push('workspace_* tools read the user\'s exported workspace with the app\'s own triage, insight and status-update engines, and can add or update tasks in the file.')
  if (platform) parts.push('platform_* tools read projects, tasks, invoices, expenses, the daily brief and the audit ledger from the platform API, and can create or toggle tasks, run the daily engine and append decisions to the ledger.')
  parts.push('search and fetch span both. Money is integer cents. Record any judgement made for the user with platform_log_decision when the platform is available.')
  return parts.join(' ')
}

export async function startStdio(config = readConfig()) {
  const server = createServer(config)
  await server.connect(new StdioServerTransport())
  return server
}

export function startHttp(config = readConfig()) {
  if (!config.authToken && !config.allowUnauthenticated) {
    throw new Error(
      'MCP_AUTH_TOKEN is required in HTTP mode. To serve without a token on this machine only, set MCP_ALLOW_UNAUTHENTICATED=true.'
    )
  }
  const bind = config.host || (config.authToken ? '0.0.0.0' : '127.0.0.1')
  if (!config.authToken && !LOOPBACK.has(bind)) {
    throw new Error(`Unauthenticated HTTP mode may only bind to a loopback address, not ${bind}. Set MCP_AUTH_TOKEN to serve on ${bind}.`)
  }
  const allowedHosts = config.allowedHosts?.length ? config.allowedHosts : config.authToken ? [] : LOCAL_HOSTS
  const hostAllowed = (req) => !allowedHosts.length || allowedHosts.includes(hostName(req.headers.host))

  const authorised = (req) => {
    if (!config.authToken) return true
    const header = req.headers.authorization || ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    const a = Buffer.from(presented)
    const b = Buffer.from(config.authToken)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', transport: 'http', path: config.path }))
      return
    }
    if (url.pathname !== config.path) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (!hostAllowed(req)) {
      res.writeHead(421, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'misdirected request: Host header not allowed' }))
      return
    }
    if (!authorised(req)) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    try {
      const server = createServer(config)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'internal error' }))
      }
    }
  })
  httpServer.listen(config.port, bind, () => {
    const mode = config.authToken ? 'bearer auth' : 'NO AUTH, loopback only'
    const hosts = allowedHosts.length ? `, hosts: ${allowedHosts.join(', ')}` : ''
    process.stderr.write(`all-dash mcp: http://${bind}:${config.port}${config.path} (${mode}${hosts})\n`)
  })
  return httpServer
}

/** True when this file is the entry point, through a bin symlink or a path with odd characters too. */
function isEntryPoint() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

const invokedDirectly = isEntryPoint()
if (invokedDirectly) {
  const config = readConfig()
  if (config.transport === 'http') startHttp(config)
  else startStdio(config).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1) })
}
