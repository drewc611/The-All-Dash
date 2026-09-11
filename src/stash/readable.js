/*
 * Turning a fetched page into something to read.
 *
 * The platform tier hands back Markdown. Everything here works on that text:
 * what it is called, who wrote it, how long it takes, what the shape of it is.
 * All pure, so it is all tested, and none of it needs a browser.
 */

/**
 * Words per minute for silent reading of English prose.
 *
 * 238 is the meta-analytic mean for non-fiction, not a number picked because
 * it looked reasonable (Brysbaert, 2019).
 *
 * Brysbaert, M. (2019). How many words do we read per minute? A review and
 * meta-analysis of reading rate. Journal of Memory and Language, 109, 104047.
 * https://doi.org/10.1016/j.jml.2019.104047
 */
export const WORDS_PER_MINUTE = 238

/** Markdown syntax is not prose and should not be counted as it. */
export function stripMarkdown(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')              // fenced code
    .replace(/`[^`\n]*`/g, ' ')                   // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // links keep their text
    .replace(/^\s{0,3}>\s?/gm, '')                // quote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')           // heading markers
    .replace(/^\s{0,3}[-*+]\s+/gm, '')            // bullets
    .replace(/^\s{0,3}\d+\.\s+/gm, '')            // ordered bullets
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, ' ')    // rules
    .replace(/[*_~]{1,3}/g, '')                   // emphasis
    .replace(/\|/g, ' ')                          // table pipes
    .replace(/\s+/g, ' ')
    .trim()
}

export function wordCount(markdown) {
  const text = stripMarkdown(markdown)
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/** Whole minutes, and never zero: "0 min read" reads like a bug. */
export function readingMinutes(words) {
  const n = Number(words) || 0
  if (n <= 0) return 0
  return Math.max(1, Math.round(n / WORDS_PER_MINUTE))
}

/** The first real paragraph. A heading or a lone image is not a summary. */
export function excerpt(markdown, limit = 240) {
  const blocks = String(markdown ?? '').split(/\n{2,}/)
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    if (/^#{1,6}\s/.test(block)) continue
    if (/^!\[/.test(block)) continue
    if (/^\s*[-*+]\s/.test(block)) continue
    if (/^\s*>/.test(block)) continue
    if (/^\s*\|/.test(block)) continue
    if (/^```/.test(block)) continue
    const text = stripMarkdown(block)
    if (text.length < 24) continue
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
  }
  return ''
}

/** The first h1, else the first heading of any level. */
export function titleFrom(markdown, fallback = '') {
  const text = String(markdown ?? '')
  const h1 = text.match(/^\s{0,3}#\s+(.+)$/m)
  if (h1) return stripMarkdown(h1[1]).slice(0, 300)
  const any = text.match(/^\s{0,3}#{2,6}\s+(.+)$/m)
  if (any) return stripMarkdown(any[1]).slice(0, 300)
  return String(fallback || '').slice(0, 300)
}

/** A hostname a person recognises: "theguardian.com", not "www.theguardian.com". */
export function siteName(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase()
    return host.replace(/^www\d?\./, '')
  } catch { return '' }
}

/** Strip the trackers a shared link is dressed in, so the same article saved
    from a newsletter and from a tweet is recognised as the same article. */
const JUNK = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$|s$|si$|spm$|_hsenc$|_hsmi$|yclid$|msclkid$|vero_id$)/i

export function canonicalUrl(input) {
  try {
    const url = new URL(String(input).trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    for (const key of [...url.searchParams.keys()]) {
      if (JUNK.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\d?\./, '')
    // A trailing slash on a path is noise; on the root it is the path.
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
    url.searchParams.sort()
    return url.toString()
  } catch { return '' }
}

/** Headings, for a table of contents down the side of a long read. */
export function outline(markdown) {
  const out = []
  const seen = new Map()
  for (const line of String(markdown ?? '').split('\n')) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!match) continue
    const text = stripMarkdown(match[2])
    if (!text) continue
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'
    // Two sections called "Notes" must not share an anchor.
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    out.push({ level: match[1].length, text, id: count === 1 ? base : `${base}-${count}` })
  }
  return out
}

/** Everything the stash needs to know about a page it just fetched. */
export function readablePage({ url, markdown, title, byline = '', site = '' }) {
  const words = wordCount(markdown)
  return {
    url: canonicalUrl(url) || String(url || ''),
    title: titleFrom(markdown, title) || siteName(url) || 'Untitled',
    byline: String(byline || '').slice(0, 200),
    site: site || siteName(url),
    excerpt: excerpt(markdown),
    words,
    minutes: readingMinutes(words),
    outline: outline(markdown),
  }
}
