"""The web tier: search, scrape, map, crawl, batch, extract and agent.

Native first (httpx, an HTML-to-Markdown reader, sitemaps, robots.txt, a
per-host rate limit and an SSRF guard). Firecrawl is optional and only used
for what the native path cannot do: web search, JavaScript rendering and
screenshots. Extract and agent need a model and stay off until one is
configured on the backend.
"""
