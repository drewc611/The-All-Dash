# syntax=docker/dockerfile:1.7
# The MCP server in HTTP mode, for ChatGPT connectors and remote clients.
# It needs the browser app's engine sources (../src) for workspace mode, so
# the build context is the repository root:
#   docker build -f mcp/Dockerfile -t alldash-mcp .
FROM node:20-alpine AS deps
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runner
ENV NODE_ENV=production MCP_TRANSPORT=http MCP_PORT=8080 MCP_PATH=/mcp
RUN apk add --no-cache tini curl \
 && addgroup --system --gid 10001 mcp \
 && adduser --system --uid 10001 --ingroup mcp mcp
WORKDIR /app
COPY --from=deps --chown=mcp:mcp /app/mcp/node_modules ./mcp/node_modules
COPY --chown=mcp:mcp mcp/package.json ./mcp/package.json
COPY --chown=mcp:mcp mcp/src ./mcp/src
# The root package.json says "type": "module"; without it the copied src/
# files would be read as CommonJS and the import of the engines fails.
COPY --chown=mcp:mcp package.json ./package.json
COPY --chown=mcp:mcp src/core ./src/core
COPY --chown=mcp:mcp src/data/schema.js ./src/data/schema.js
COPY --chown=mcp:mcp src/engine ./src/engine
COPY --chown=mcp:mcp src/brain ./src/brain
# The five agents and the genome they retrieve over. src/stash/search.js is
# the BM25 index the Librarian uses - the same one the stash searches with.
# Anything the server imports and the image does not carry is a container that
# starts and dies instantly, so mcp/test asserts this list against the real
# import graph rather than trusting it to stay right.
COPY --chown=mcp:mcp src/agents ./src/agents
COPY --chown=mcp:mcp src/genome ./src/genome
COPY --chown=mcp:mcp src/stash/search.js ./src/stash/search.js
USER mcp:mcp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "mcp/src/server.js"]
