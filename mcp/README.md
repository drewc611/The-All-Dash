# The All Dash MCP server

One server, three clients. Claude (Desktop and Code), GitHub Copilot (VS Code
agent mode) and ChatGPT (connectors) all speak the Model Context Protocol, so
this is the one place the dashboard is exposed to an agent.

Two sources, either or both:

| Source | Env | What you get |
|---|---|---|
| Workspace export | `ALLDASH_WORKSPACE_FILE=/path/to/all-dash-2026-09-08.json` | `workspace_*` tools: overview, triage, status update, search, add and update tasks, and `workspace_brain` (what the app learned about the user, as Markdown; rules only, no model). Read with the browser app's own engines, so "late" means what the Triage view means. Writes go into the file; re-import it in the app. |
| Platform API | `ALLDASH_API_URL=http://localhost:8000` + `ALLDASH_API_KEY` | `platform_*` tools: brief, pipelines, today's checklist, tasks, invoices, expenses, finance summary, audit log, verify, log a decision, run the daily engine. |

`search` and `fetch` span both and follow the shape ChatGPT requires
(`{results:[{id,title,url}]}` and `{id,title,text,url,metadata}`), with ids
prefixed `ws:` or `pf:`.

Every judgement an agent makes for the user belongs in the ledger:
`platform_log_decision` appends it with a confidence score, as actor
`assistant`, to the same hash chain the system's own decisions use. The
`morning-review` prompt ends by recording the "do first" choice that way.

```bash
cd mcp && npm install
npm test                     # in-memory client, stub API, HTTP auth
node src/server.js           # stdio
MCP_TRANSPORT=http MCP_AUTH_TOKEN=... node src/server.js   # :8080/mcp
```

## Claude Code

Outside this repository, install it as a plugin:

```
/plugin marketplace add drewc611/The-All-Dash
/plugin install all-dash@the-all-dash
```

The plugin runs `npm ci` in its own copy of `mcp/` the first time the server
starts. With nothing configured it reads `~/.all-dash/workspace.json` if that
file exists (save your export there), so the first run needs no environment
variables at all.

Inside this repository, `.mcp.json` at the root already registers the server.
Export the variables it references before starting Claude Code here:

```bash
export ALLDASH_WORKSPACE_FILE=~/Downloads/all-dash-2026-09-08.json
export ALLDASH_API_URL=http://localhost:8000
export ALLDASH_API_KEY=dev-key-change-me
```

The `all-dash` skill in `.claude/skills/all-dash/SKILL.md` tells Claude how to
use the tools and to record decisions.

## Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "all-dash": {
      "command": "node",
      "args": ["/absolute/path/to/The-All-Dash/mcp/src/server.js"],
      "env": {
        "ALLDASH_WORKSPACE_FILE": "/absolute/path/to/all-dash-export.json",
        "ALLDASH_API_URL": "http://localhost:8000",
        "ALLDASH_API_KEY": "dev-key-change-me"
      }
    }
  }
}
```

Or, for a deployed platform, add a remote server under Settings → Connectors
with `https://<host>/mcp` and the bearer token from the `alldash-mcp` Secret.

## GitHub Copilot (VS Code)

`.vscode/mcp.json` registers the server for agent mode and prompts for the API
key and export path the first time. Open the Copilot chat, switch to Agent,
and the tools appear under `all-dash`. `.github/copilot-instructions.md`
explains the repository and when to log decisions.

## ChatGPT

Two options.

**Connector (MCP).** Deploy the platform (README, "EKS deployment playbook");
the Ingress publishes the server at `https://<host>/mcp` behind a bearer token.
In ChatGPT: Settings → Connectors → Create, URL `https://<host>/mcp`,
authentication "Bearer", paste the token. Deep research and chat use `search`
and `fetch`; in developer mode every tool is available.

**Custom GPT action (REST).** Import `docs/openapi.json` as the schema of a
GPT action, set authentication to API key with header name `X-API-Key`, and
point the server URL at the API. This needs the API on the Ingress, which the
manifests deliberately leave off; add a `/api/platform` path to
`k8s/ingress/*/ingress.yaml` if you want it.

## Security

- The bearer token is compared in constant time. HTTP mode refuses to start
  without `MCP_AUTH_TOKEN`; `MCP_ALLOW_UNAUTHENTICATED=true` overrides that for
  local use, and then the server binds to 127.0.0.1 only and answers only
  localhost `Host` headers (421 otherwise), which defeats DNS rebinding.
  `MCP_ALLOWED_HOSTS` pins the accepted host names on a deployed server too.
- HTTP mode is stateless (a fresh server per request), so it scales behind a
  load balancer with no session affinity.
- The server never holds the workspace in memory longer than two seconds
  between reads, and writes the export atomically (temp file, then rename).
- Runs as uid 10001 with a read-only filesystem in the container.
