import { ingestText } from '../ingest/index.js'
import { updateSettings } from '../core/store.js'
import { addDays, dayKey } from '../core/time.js'

/**
 * The sample project is not fixture data - it is four real documents run
 * through the real parsers. If the sample looks right, the pipeline works.
 */

const pad = (n) => String(n).padStart(2, '0')
const d = (offset) => dayKey(addDays(new Date(), offset))
const stamp = (offset, hour, minute = 0) => {
  const date = addDays(new Date(), offset)
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(hour)}${pad(minute)}00`
}

const NOTES = `# Atlas migration - weekly sync
Project: Atlas
Attendees: Sam Ojo, Priya Raman, Dev Kaur, Marco Bianchi
Date: ${d(-2)}

The read replica cutover went out on Tuesday with no customer-visible downtime.
Support saw three tickets, all related to stale caches, all resolved inside an hour.

## Action items
- [x] Publish the cutover runbook @Dev
- [ ] Rewrite the rollback script for the write path @Priya by ${d(1)} #infra
- [ ] Get sign-off from Legal on the data residency note @Sam by ${d(4)} #compliance
- [ ] Benchmark p99 on the new cluster @Marco by ${d(6)} #infra
- [ ] Draft the customer comms for phase two @Sam by ${d(9)}

## Decisions
Decision: phase two ships behind a per-tenant flag, not a global one
Decision: we keep the old cluster warm for fourteen days after cutover

## Risks
Risk: the rollback script has never been run against production data
Blocker: Legal review of the residency note is unscheduled

## Open questions
Question: who owns the runbook once Dev rotates off in November
Q: do we need a second region before the enterprise renewal

## Metrics
Error rate: 0.4%
p99 latency: 184 ms
Migrated tenants: 61
Support tickets: 3

## Timeline
- ${d(4)} - Legal sign-off
- ${d(12)} - Phase two flag enabled for pilot tenants
- ${d(26)} - Old cluster decommissioned
- ${d(40)} - Atlas migration closed out
`

const RETRO = `# Atlas retro - phase one
Attendees: Priya Raman, Dev Kaur
Date: ${d(-6)}

Phase one took eleven days against a nine-day estimate. The slip was entirely in
review latency, not in the work itself.

## Action items
- [ ] Set a 24h review SLA for migration PRs @Dev #process
- [ ] Add a dashboard for review wait time @Priya by ${d(8)} #process

## Decisions
Decision: pair on the rollback script rather than review it asynchronously

## Metrics
Cycle time: 4.1 d
Review wait: 19 h
`

const STANDUP = `WEBVTT

00:00:02.000 --> 00:00:09.400
Priya Raman: Morning. I'll rewrite the rollback script today, it's the last thing blocking phase two.

00:00:09.400 --> 00:00:16.900
Dev Kaur: I'm blocked on the staging database, the restore has been running for six hours.

00:00:16.900 --> 00:00:24.100
Sam Ojo: Can you send me the residency note before lunch? Legal wants it in this week's batch.

00:00:24.100 --> 00:00:31.000
Priya Raman: Yes. We decided to pair on the rollback script, so Dev and I will take an hour after this.

00:00:31.000 --> 00:00:38.500
Marco Bianchi: I'm worried about the p99 numbers on the new cluster, they're higher than the old one under load.
`

const CALENDAR = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//All Dash//Sample//EN
BEGIN:VEVENT
UID:atlas-standup
SUMMARY:Atlas standup
DTSTART:${stamp(0, 9, 30)}
DTEND:${stamp(0, 9, 45)}
RRULE:FREQ=DAILY;COUNT=14
LOCATION:Meet
ORGANIZER;CN=Priya Raman:mailto:priya@example.com
ATTENDEE;CN=Dev Kaur:mailto:dev@example.com
ATTENDEE;CN=Sam Ojo:mailto:sam@example.com
END:VEVENT
BEGIN:VEVENT
UID:atlas-legal
SUMMARY:Legal review - data residency
DTSTART:${stamp(1, 14, 0)}
DTEND:${stamp(1, 15, 0)}
DESCRIPTION:Agenda\\nAction: bring the redlined residency note\\nQuestion: does the pilot need a separate DPA
ORGANIZER;CN=Sam Ojo:mailto:sam@example.com
ATTENDEE;CN=Priya Raman:mailto:priya@example.com
END:VEVENT
BEGIN:VEVENT
UID:atlas-review
SUMMARY:Phase two readiness review
DTSTART:${stamp(3, 11, 0)}
DTEND:${stamp(3, 12, 30)}
LOCATION:Room 4
ORGANIZER;CN=Marco Bianchi:mailto:marco@example.com
ATTENDEE;CN=Sam Ojo:mailto:sam@example.com
ATTENDEE;CN=Dev Kaur:mailto:dev@example.com
END:VEVENT
BEGIN:VEVENT
UID:atlas-focus
SUMMARY:Focus block - rollback script
DTSTART:${stamp(0, 13, 0)}
DTEND:${stamp(0, 15, 0)}
ORGANIZER;CN=Priya Raman:mailto:priya@example.com
END:VEVENT
END:VCALENDAR
`

function sheet() {
  const rows = ['Date,Migrated tenants,Error rate,p99 latency,Support tickets,Review wait']
  let tenants = 12
  for (let i = 27; i >= 0; i--) {
    tenants += Math.round(1 + Math.random() * 3)
    const errorRate = (0.9 - i * 0.02 + Math.random() * 0.2).toFixed(2)
    const p99 = Math.round(240 - i * 1.6 + Math.random() * 30)
    const tickets = Math.max(0, Math.round(4 - i * 0.08 + (Math.random() > 0.85 ? 6 : 0)))
    const wait = (26 - i * 0.3 + Math.random() * 6).toFixed(1)
    rows.push(`${d(-i)},${tenants},${errorRate},${p99},${tickets},${wait}`)
  }
  return rows.join('\n')
}

const BACKLOG = `Task,Owner,Status,Due,Priority,Tags
Shard the events table,Dev Kaur,In progress,${d(5)},P1,infra
Retire the legacy sync job,Marco Bianchi,Blocked,${d(11)},P2,infra
Write the tenant migration FAQ,Sam Ojo,To do,${d(7)},,comms
Add residency flags to the admin UI,Priya Raman,To do,${d(14)},P1,compliance
Backfill audit logs,Dev Kaur,Done,${d(-3)},,infra
Load test the pilot cohort,Marco Bianchi,To do,${d(10)},P1,infra
Update the status page copy,Sam Ojo,Done,${d(-1)},,comms
`

/** Load the sample project. Safe to call twice - ids are content-derived. */
export async function seedWorkspace() {
  await ingestText(NOTES, 'Atlas weekly sync.md')
  await ingestText(RETRO, 'Atlas phase one retro.md')
  await ingestText(STANDUP, 'Standup recording.vtt')
  await ingestText(CALENDAR, 'Atlas calendar.ics')
  await ingestText(sheet(), 'Atlas migration metrics.csv')
  await ingestText(BACKLOG, 'Atlas backlog.csv')
  updateSettings({ seeded: true })
}
