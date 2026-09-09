import { ingestFile } from './index.js'
import { webCrawl, webScrape } from '../platform/client.js'

/**
 * A web page is a document like any other: the platform turns it into
 * Markdown, and from there it takes the same road as a pasted note, so
 * tasks, dates, people, decisions and numbers on the page become entities.
 * The document remembers its URL; importing the same page again replaces
 * what it produced, which is what "refresh" means here.
 */

/** A stable, readable file name for a page: its title, then its host and path. */
export function pageToFile(page) {
  const url = page.final_url || page.url || ''
  let host = ''
  let path = ''
  try {
    const parsed = new URL(url)
    host = parsed.hostname.replace(/^www\./, '')
    path = parsed.pathname.replace(/\/+$/, '')
  } catch {
    // keep the name from the title alone
  }
  const title = String(page.title || '').replace(/\s+/g, ' ').trim() || path.split('/').filter(Boolean).pop() || host || 'Page'
  const where = host ? ` [${host}${path}]` : ''
  const name = `${title.slice(0, 90)}${where}`.replace(/[\\*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) + '.md'
  const head = [`# ${title}`, '', url ? `Source: ${url}` : '', page.description ? `> ${page.description}` : '', ''].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
  return { name, text: `${head}\n${page.markdown || ''}`.trim() + '\n', url }
}

/**
 * Import one page, or crawl a site from it. Calls `onProgress(text)` as it
 * goes and returns what was read.
 */
export async function importUrl(url, { crawl = false, limit = 10, onProgress, signal } = {}) {
  const say = (text) => onProgress?.(text)
  say(crawl ? `Crawling ${url}…` : `Reading ${url}…`)
  const pages = []
  const failures = []
  if (crawl) {
    const result = await webCrawl(url, { limit }, { signal })
    if (result.status === 'queued') throw new Error('That crawl is too large to run inside a request; lower the page limit.')
    pages.push(...result.pages)
    failures.push(...result.failures)
  } else {
    const page = await webScrape(url, { signal })
    if (page.status >= 400) throw new Error(`${page.final_url || url} answered HTTP ${page.status}.`)
    pages.push(page)
  }
  const docs = []
  let entities = 0
  for (const [i, page] of pages.entries()) {
    say(`Reading ${i + 1} of ${pages.length}: ${page.title || page.final_url}`)
    const file = pageToFile(page)
    const result = await ingestFile(new File([file.text], file.name, { type: 'text/markdown' }), { url: file.url })
    docs.push(result.doc)
    entities += result.entities.length
  }
  return { docs, entities, failures, pages: pages.length }
}
