import { defineParser } from '../../core/registry.js'
import { extractFromText, titleCase } from '../extract.js'
import { iso } from '../../core/time.js'

/**
 * Meeting transcripts (.vtt, .srt, and the "Name: sentence" exports most
 * conferencing tools produce). Timestamps go, speaker turns get merged, and
 * the result is read as notes - so a recording and a written note land in the
 * same place with the same commitments pulled out of them.
 */

const TIMECODE = /^\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?\s*-->\s*/
const CUE_INDEX = /^\d+$/
const SPEAKER = /^([A-Z][\w .'-]{1,40}?)\s*(?:\((\d{1,2}:\d{2}(?::\d{2})?)\))?\s*:\s*(.+)$/

export function transcriptToTurns(text) {
  const lines = String(text || '').split(/\r?\n/)
  const turns = []
  let current = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line === 'WEBVTT' || CUE_INDEX.test(line) || TIMECODE.test(line)) continue
    if (/^NOTE\b/.test(line)) continue

    const cleaned = line.replace(/<[^>]+>/g, '').trim()
    if (!cleaned) continue

    const speaker = cleaned.match(SPEAKER)
    if (speaker && speaker[1].split(' ').length <= 4) {
      if (current) turns.push(current)
      current = { speaker: titleCase(speaker[1]), time: speaker[2] || null, text: speaker[3] }
    } else if (current) {
      current.text += ` ${cleaned}`
    } else {
      current = { speaker: null, time: null, text: cleaned }
    }
  }
  if (current) turns.push(current)
  return turns
}

const COMMITMENT =
  /\b(I(?:'| wi)ll|I can|we(?:'| wi)ll|let me|I'm going to|I am going to|going to)\s+([a-z][^.?!]{4,120})/i
const ASSIGNMENT = /\b(?:can you|could you|please|would you)\s+([a-z][^.?!]{4,120})/i
const DECISION = /\b(?:we (?:decided|agreed)|let's go with|final answer is|the call is)\s+([^.?!]{4,140})/i
const RISKY = /\b(?:blocked (?:on|by)|at risk|worried about|the risk is|concern(?:ed)? (?:about|is))\s+([^.?!]{4,140})/i

defineParser({
  id: 'transcript',
  name: 'Meeting transcripts',
  extensions: ['.vtt', '.srt', '.transcript'],
  priority: 20,
  match: ({ name, text }) =>
    /\.(vtt|srt|transcript)$/i.test(name || '') || /^WEBVTT/.test(String(text || '').trim()),
  parse: ({ name, text, docId, kind }) => {
    const source = { docId, name, kind }
    const turns = transcriptToTurns(text)
    const at = iso(new Date())
    const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))]
    const entities = []

    turns.forEach((turn, i) => {
      const sentences = turn.text.split(/(?<=[.?!])\s+/)
      for (const sentence of sentences) {
        const base = {
          source: { ...source, line: i + 1 },
          people: turn.speaker ? [turn.speaker] : [],
          tags: ['transcript'],
          at: null,
        }
        const decision = sentence.match(DECISION)
        if (decision) {
          entities.push({ ...base, type: 'decision', title: trim(decision[1]), confidence: 0.7 })
          continue
        }
        const risk = sentence.match(RISKY)
        if (risk) {
          entities.push({ ...base, type: 'risk', title: trim(risk[1]), status: 'open', confidence: 0.65 })
          continue
        }
        const commit = sentence.match(COMMITMENT)
        if (commit) {
          entities.push({ ...base, type: 'task', title: trim(commit[2]), status: 'open', confidence: 0.7 })
          continue
        }
        const ask = sentence.match(ASSIGNMENT)
        if (ask) {
          entities.push({ ...base, type: 'task', title: trim(ask[1]), status: 'open', confidence: 0.6 })
        }
      }
    })

    // Still run the marker reader, because plenty of transcripts have a
    // pasted action-items block at the end.
    const flat = turns.map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join('\n')
    entities.push(...extractFromText(flat, source).entities.filter((e) => e.type !== 'note'))

    entities.push({
      type: 'note',
      title: name.replace(/\.[a-z0-9]+$/i, ''),
      body: turns.slice(0, 80).map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join('\n'),
      at,
      people: speakers,
      tags: ['transcript', 'notes'],
      source,
      confidence: 1,
    })

    for (const speaker of speakers) {
      entities.push({
        type: 'person', title: speaker, at, people: [speaker], tags: ['attendee'], source, confidence: 0.9,
      })
    }
    return entities
  },
})

const trim = (s) => String(s).replace(/\s{2,}/g, ' ').replace(/[,;:\s]+$/, '').trim()

