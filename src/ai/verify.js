/*
 * Grading a reply.
 *
 * Every gateway treats HTTP 200 as success and falls back only on an error
 * code. That misses the failures that actually cost you something: a stream
 * cut off mid-sentence, an answer citing a task that does not exist, a
 * proposal with a field the store would reject, a model that returned the
 * empty string and a 200.
 *
 * This app can do better than a general gateway because it knows what the
 * answer was supposed to be grounded in. A citation either resolves to a real
 * entity or it does not, and that is a fact, not a heuristic. So a reply is
 * graded against the workspace it claims to describe, and a bad grade is a
 * reason to try the next provider - exactly as if the first had returned 503.
 */

import { parseReply, CITATION } from './protocol.js'

export const GRADES = {
  ok: { retry: false, label: 'Good' },
  empty: { retry: true, label: 'Empty reply' },
  truncated: { retry: true, label: 'Cut off' },
  'unresolved-citation': { retry: true, label: 'Cited something that does not exist' },
  'bad-action': { retry: true, label: 'Proposed an invalid change' },
  refusal: { retry: true, label: 'Refused' },
}

// Short, apologetic, and content-free. Length matters: a long answer that
// happens to contain "I cannot" is an answer, not a refusal.
const REFUSAL = /\b(i (?:can(?:no|')t|am (?:un)?able to|won'?t)|as an ai|i'?m sorry,? but)\b/i
const REFUSAL_MAX_CHARS = 320

/**
 * Grade one reply.
 *
 * `known` is the entity map the answer was built from. Without it the
 * citation check is skipped rather than guessed at - a grader that invents
 * failures is worse than no grader.
 */
export function grade(reply, { known = null, stop = null, expectActions = false } = {}) {
  const raw = String(reply ?? '')
  const text = raw.trim()

  if (!text) return verdict('empty', 'The provider returned nothing.')

  // Checked before the citation test: a cut-off reply often ends mid-citation
  // and would otherwise be reported as the wrong failure.
  if (stop === 'length' || stop === 'max_tokens') {
    return verdict('truncated', 'The reply hit the token cap and stopped mid-thought.')
  }

  if (text.length <= REFUSAL_MAX_CHARS && REFUSAL.test(text)) {
    return verdict('refusal', 'The model declined rather than answering.')
  }

  if (known) {
    const cited = [...raw.matchAll(CITATION)].map((match) => match[1])
    const missing = [...new Set(cited.filter((id) => !Object.hasOwn(known, id)))]
    if (missing.length) {
      return verdict(
        'unresolved-citation',
        `The answer cites ${missing.length === 1 ? 'an item' : `${missing.length} items`} that are not in your workspace.`,
        { missing },
      )
    }
  }

  const parsed = parseReply(raw, { known })

  // Only a claim of actions that all failed validation is a failure. A reply
  // with no actions at all is an answer to a question, which is most of them.
  if (expectActions && claimsActions(raw) && !parsed.actions.length) {
    return verdict('bad-action', 'The proposed changes were malformed and none survived validation.')
  }

  return verdict('ok', '', { citations: parsed.citations, actions: parsed.actions })
}

const claimsActions = (raw) => /```(?:actions|json)\s*\n/.test(String(raw))

function verdict(code, reason, extra = {}) {
  return { code, ok: code === 'ok', retry: GRADES[code]?.retry ?? false, label: GRADES[code]?.label || code, reason, ...extra }
}

/**
 * Whether to try the next provider.
 *
 * A transport failure always retries. A graded failure retries too, which is
 * the whole point - but only while a better answer is still plausible, so a
 * refusal repeated by two different models is taken at its word rather than
 * chased around the catalogue.
 */
export function shouldFallBack(verdicts, { maxRetries = 2 } = {}) {
  const list = verdicts || []
  if (!list.length) return true
  if (list.length > maxRetries) return false
  const last = list[list.length - 1]
  if (!last?.retry) return false
  // Two independent models declining is a fact about the request.
  const refusals = list.filter((v) => v.code === 'refusal').length
  if (refusals >= 2) return false
  return true
}

/** A sentence for the ledger and the panel. */
export function describeVerdict(verdict) {
  if (!verdict) return ''
  if (verdict.ok) return 'Answered'
  return verdict.reason || verdict.label || 'Failed'
}
