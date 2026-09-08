#!/usr/bin/env node
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { readConfig } from './config.js'
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
 */

export function createServer(config = readConfig()) {
  const workspace = config.workspaceFile ? new WorkspaceAdapter(config.workspaceFile) : null
  const platform = config.apiUrl ? new PlatformAdapter(config.apiUrl, config.apiKey) : null
  if (!workspace && !platform) {
    throw new Error('Set ALLDASH_WORKSPACE_FILE (an export of the browser app) and/or ALLDASH_API_URL (the platform API).')
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
  httpServer.listen(config.port, '0.0.0.0', () => {
    process.stderr.write(`all-dash mcp: http://0.0.0.0:${config.port}${config.path} (${config.authToken ? 'bearer auth' : 'no auth'})\n`)
  })
  return httpServer
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) {
  const config = readConfig()
  if (config.transport === 'http') startHttp(config)
  else startStdio(config).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1) })
}
