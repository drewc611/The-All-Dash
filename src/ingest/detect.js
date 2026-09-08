/**
 * Recognise the exports people actually have.
 *
 * Nothing needs installing or connecting: a Jira CSV, a Trello board JSON,
 * a Todoist export or a Google Calendar .ics is recognised from its own
 * header and read with that tool's quirks handled, so the columns it
 * invented land as the right fields. Unrecognised files still take the
 * generic route; a flavor only ever adds knowledge.
 */

export const FLAVORS = {
  jira: { id: 'jira', label: 'Jira export' },
  linear: { id: 'linear', label: 'Linear export' },
  asana: { id: 'asana', label: 'Asana export' },
  todoist: { id: 'todoist', label: 'Todoist export' },
  trello: { id: 'trello', label: 'Trello board' },
  github: { id: 'github', label: 'GitHub issues' },
  'google-calendar': { id: 'google-calendar', label: 'Google Calendar' },
  outlook: { id: 'outlook', label: 'Outlook calendar' },
  'apple-calendar': { id: 'apple-calendar', label: 'Apple Calendar' },
  zoom: { id: 'zoom', label: 'Zoom transcript' },
  teams: { id: 'teams', label: 'Teams transcript' },
}

/** @returns {{id:string,label:string}|null} */
export function detectFlavor({ name = '', text = '' }) {
  const head = String(text || '').slice(0, 4000)
  if (!head.trim()) return null
  const lower = name.toLowerCase()

  if (/\.(ics|ical)$/.test(lower) || /BEGIN:VCALENDAR/.test(head)) {
    const prodid = head.match(/PRODID:([^\r\n]+)/i)?.[1] || ''
    if (/google/i.test(prodid)) return FLAVORS['google-calendar']
    if (/microsoft|outlook|exchange/i.test(prodid)) return FLAVORS.outlook
    if (/apple|icloud|macos/i.test(prodid)) return FLAVORS['apple-calendar']
    return null
  }

  if (/\.(vtt|srt)$/.test(lower) || /^WEBVTT/.test(head)) {
    if (/zoom/i.test(head.slice(0, 200))) return FLAVORS.zoom
    if (/microsoft teams|<v /i.test(head.slice(0, 400))) return FLAVORS.teams
    return null
  }

  const trimmed = head.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (/"idList"/.test(head) && /"cards"|"idBoard"/.test(head)) return FLAVORS.trello
    if (/"html_url"/.test(head) && /"number"/.test(head) && /"labels"|"assignees"|"pull_request"/.test(head)) return FLAVORS.github
    return null
  }

  const headerLine = head.split(/\r?\n/).find((l) => l.trim()) || ''
  const cols = headerLine.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim().toLowerCase())
  const has = (...names) => names.every((n) => cols.includes(n))
  if (has('issue key') || (has('summary', 'issue type'))) return FLAVORS.jira
  if (has('task id', 'name') && (cols.includes('section/column') || cols.includes('assignee email'))) return FLAVORS.asana
  if (has('type', 'content', 'priority', 'date')) return FLAVORS.todoist
  if (has('team', 'title', 'status') && (cols.includes('cycle name') || cols.includes('cycle number') || cols.includes('project milestone'))) return FLAVORS.linear
  return null
}

/**
 * Reshape a table the way its source tool means it. Returns a new table;
 * the input is never mutated.
 * @param {{headers:string[], rows:any[][]}} table
 */
export function applyFlavor(table, flavor) {
  if (!flavor || !table?.headers?.length) return table
  const rename = (map) => table.headers.map((h) => map[h.trim().toLowerCase()] || h)
  const col = (name) => table.headers.findIndex((h) => h.trim().toLowerCase() === name)

  if (flavor.id === 'todoist') {
    const type = col('type')
    const priority = col('priority')
    const rows = table.rows
      .filter((r) => type < 0 || String(r[type]).toLowerCase() === 'task')
      .map((r) => r.map((cell, i) => (i === priority ? todoistPriority(cell) : cell)))
    return { ...table, headers: rename({ content: 'Title', date: 'Due date', responsible: 'Owner', description: 'Notes' }), rows }
  }

  if (flavor.id === 'asana') {
    const completed = col('completed at')
    const headers = [...rename({ 'section/column': 'Section', name: 'Title' }), 'Status']
    const rows = table.rows.map((r) => [...r, completed >= 0 && String(r[completed]).trim() ? 'done' : 'open'])
    return { ...table, headers, rows }
  }

  if (flavor.id === 'jira') {
    return { ...table, headers: rename({ summary: 'Title', 'issue type': 'Type', 'due date': 'Due date' }) }
  }

  if (flavor.id === 'linear') {
    return { ...table, headers: rename({ description: 'Notes' }) }
  }

  return table
}

/** Todoist exports 4 as the highest priority and 1 as none. */
const todoistPriority = (cell) => ({ 4: 'p0', 3: 'p1', 2: 'p2' }[String(cell).trim()] || '')

/** A Trello board JSON becomes a task table: one row per open card. */
export function trelloToTable(data) {
  const lists = new Map((data.lists || []).map((l) => [l.id, l]))
  const members = new Map((data.members || []).map((m) => [m.id, m.fullName || m.username || '']))
  const headers = ['Title', 'Status', 'List', 'Owner', 'Tags', 'Due', 'Notes']
  const rows = (data.cards || [])
    .filter((c) => c && c.name)
    .map((c) => {
      const list = lists.get(c.idList)
      const listName = list?.name || ''
      const status = c.closed || list?.closed ? 'done' : listName
      return [
        c.name,
        status,
        listName,
        (c.idMembers || []).map((id) => members.get(id)).filter(Boolean).join(', '),
        (c.labels || []).map((l) => l.name).filter(Boolean).join(', '),
        c.due || '',
        c.desc || '',
      ]
    })
  return { headers, rows, sheet: data.name || undefined }
}

/** A GitHub issues array (REST shape) becomes a task table. */
export function githubToTable(records) {
  const headers = ['Title', 'Status', 'Owner', 'Tags', 'Created', 'Due date', 'Notes']
  const rows = records
    .filter((r) => r && r.title)
    .map((r) => [
      `#${r.number} ${r.title}`,
      r.state === 'closed' ? 'done' : 'open',
      (r.assignees || (r.assignee ? [r.assignee] : [])).map((a) => a.login || a.name).filter(Boolean).join(', '),
      [...(r.labels || []).map((l) => (typeof l === 'string' ? l : l.name)), r.pull_request ? 'pull-request' : 'issue', r.milestone?.title].filter(Boolean).join(', '),
      r.created_at || '',
      r.milestone?.due_on || '',
      [r.html_url, (r.body || '').slice(0, 400)].filter(Boolean).join('\n'),
    ])
  return { headers, rows }
}

export const looksLikeTrello = (data) => Boolean(data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.cards) && Array.isArray(data.lists))
export const looksLikeGithubIssues = (data) =>
  Array.isArray(data) && data.length > 0 && data.every((r) => r && typeof r === 'object' && 'number' in r && 'title' in r && ('html_url' in r || 'labels' in r))
