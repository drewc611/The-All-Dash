import { useCallback, useEffect, useMemo, useState } from 'react'
import { corpusFrom, indexCorpus } from '../../agents/librarian.js'
import { run, AGENTS } from '../../agents/pipeline.js'
import { allCards, keep, grade, due, stats } from '../../agents/study.js'
import { genes, learn, credit, agree, disagree, prune, forget } from '../../genome/store.js'
import { explainFitness } from '../../genome/evolve.js'
import { corpus } from '../../stash/archive.js'
import { available } from '../../core/idb.js'
import { addEntity } from '../../core/store.js'
import { makeEntity } from '../../data/schema.js'
import { Empty, Card } from '../components.jsx'
import { IconSpark, IconBrain, IconBulb, IconCheck, IconTrash, IconRefresh } from '../icons.jsx'

const TABS = [
  { id: 'ask', label: 'Ask', Icon: IconSpark },
  { id: 'study', label: 'Study', Icon: IconBulb },
  { id: 'genome', label: 'Genome', Icon: IconBrain },
]

/**
 * The agents.
 *
 * Five of them, and the screen says what each one did rather than presenting
 * one confident paragraph. That is the whole difference between this and a
 * chat box: an answer you can take apart is an answer you can disagree with.
 */
export function Agents({ state, entities, onToast, onOpen }) {
  const [tab, setTab] = useState('ask')
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [articles, setArticles] = useState(new Map())

  const population = useMemo(() => genes(state), [state.entities])
  const cards = useMemo(() => allCards(state), [state.study])
  const queue = useMemo(() => due(), [state.study])
  const counts = useMemo(() => stats(), [state.study])

  // Saved articles are the bulk of what there is to retrieve over, and they
  // live in IndexedDB rather than the workspace. Read once per change.
  useEffect(() => {
    if (!available()) return undefined
    const ids = entities.filter((e) => e.meta?.snapshotId).map((e) => e.meta.snapshotId)
    if (!ids.length) return undefined
    let live = true
    corpus(ids).then((rows) => { if (live) setArticles(new Map(rows.map((r) => [r.id, r.text]))) }).catch(() => {})
    return () => { live = false }
  }, [entities.length])

  const index = useMemo(
    () => indexCorpus(corpusFrom(entities, population, articles)),
    [entities, population, articles],
  )

  const ask = useCallback(async (text) => {
    const asked = String(text ?? question).trim()
    if (!asked || busy) return
    setBusy(true)
    try {
      // Tasks are checked against what is already on a board; claims against
      // what the genome already holds. See planner.js for why not one set.
      const existing = new Set(entities.filter((e) => e.type !== 'gene').map((e) => e.title))
      const claims = new Set(population.map((g) => g.claim))
      const outcome = await run(asked, { index, genes: population, existing, claims })
      setResult(outcome)
      // Cards go into the queue as they are cut; the schedule of any card
      // already being studied is left alone.
      const added = keep(outcome.cards)
      // Crediting is what keeps a claim the answer leaned on from decaying.
      if (outcome.citedGenes.length) credit(outcome.citedGenes)
      if (added) onToast?.(`${added} new card${added === 1 ? '' : 's'} to study`, 'good')
    } catch (error) {
      onToast?.(`The agents could not finish: ${error.message}`, 'critical')
    } finally {
      setBusy(false)
    }
  }, [question, busy, index, population, entities, onToast])

  // The inspector wants the record, not an id. Everything the agents cite is
  // an entity - a gene included - so one lookup covers all of it.
  const openById = useCallback((id) => {
    const entity = entities.find((e) => e.id === id)
    if (entity) onOpen?.(entity)
  }, [entities, onOpen])

  const applyProposal = (proposal) => {
    if (proposal.apply.type === 'gene') {
      learn([{ claim: proposal.apply.claim, body: proposal.apply.body, topic: 'agents', sources: proposal.apply.sources, tags: proposal.apply.tags }])
      onToast?.('Kept as a claim.', 'good')
    } else {
      addEntity(makeEntity({ ...proposal.apply, source: { docId: 'agents', name: 'The agents', kind: 'agents', url: '', line: null } }))
      onToast?.('Added to your tasks.', 'good')
    }
    setResult((r) => (r ? { ...r, proposals: r.proposals.filter((p) => p.id !== proposal.id) } : r))
  }

  return (
    <div className="stack">
      <header className="wtabs">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="wtab" aria-current={tab === id} onClick={() => setTab(id)}>
            <Icon width={12} height={12} /> {label}
            {id === 'study' && counts.due > 0 ? <span className="wtab__count">{counts.due}</span> : null}
            {id === 'genome' && population.length > 0 ? <span className="wtab__count">{population.length}</span> : null}
          </button>
        ))}
      </header>

      {tab === 'ask' && (
        <Ask
          question={question}
          setQuestion={setQuestion}
          onAsk={ask}
          busy={busy}
          result={result}
          onOpen={openById}
          onApply={applyProposal}
        />
      )}
      {tab === 'study' && <Study queue={queue} counts={counts} cards={cards} onToast={onToast} />}
      {tab === 'genome' && <Genome population={population} onToast={onToast} onOpen={openById} />}
    </div>
  )
}

/* ------------------------------------------------------------------ ask */

function Ask({ question, setQuestion, onAsk, busy, result, onOpen, onApply }) {
  return (
    <div className="stack">
      <form className="agents__ask" onSubmit={(e) => { e.preventDefault(); onAsk() }}>
        <input
          className="input agents__q"
          value={question}
          placeholder="Ask across everything you have saved"
          aria-label="Ask the agents"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !question.trim()}>
          {busy ? 'Working…' : 'Ask'}
        </button>
      </form>

      {!result ? (
        <div className="agents__roster">
          {AGENTS.map((agent) => (
            <div key={agent.id} className="agents__role">
              <strong>{agent.label}</strong>
              <span className="muted">{agent.does}</span>
            </div>
          ))}
          <p className="muted agents__note">
            No model is needed. Retrieval, the contradictions, the cards and the checking are all
            arithmetic over your own material. If a model chain is set up in Settings the answer is
            written rather than assembled — and it is held to the same rule, so it cannot tell you
            anything your workspace does not already say.
          </p>
        </div>
      ) : (
        <Answer result={result} onOpen={onOpen} onApply={onApply} />
      )}
    </div>
  )
}

function Answer({ result, onOpen, onApply }) {
  const byId = new Map(result.passages.map((p) => [p.id, p]))
  const grade = result.critique.verdict.grade

  return (
    <div className="stack">
      <Card title="Answer" tools={<span className={`chip chip--${grade === 'clean' ? 'good' : grade === 'unusable' ? 'critical' : 'warning'}`}>{result.critique.verdict.text}</span>}>
        {result.answer ? (
          <div className="agents__answer">
            {result.answer.split('\n\n').map((claim, i) => (
              <p key={i}>{renderCitations(claim, byId, onOpen)}</p>
            ))}
          </div>
        ) : (
          <Empty title="Nothing stood up" hint="Every sentence the agents could assemble cited something that is not in your workspace, so none of it is shown." />
        )}
        <p className="muted agents__meta">
          {result.usedModel ? 'Written by your model chain, checked against the passages.' : 'Assembled from your own sentences. No model involved.'}
        </p>
      </Card>

      {result.analysis.gaps.length > 0 && (
        <Card title="Nothing saved about">
          {/* Gaps are kept out of the answer on purpose: a gap has nothing to
              cite, and the rule that every claim carries a citation only
              means anything with no exceptions. */}
          <div className="row row--wrap">
            {result.analysis.gaps.map((word) => <span key={word} className="chip">{word}</span>)}
          </div>
        </Card>
      )}

      {result.proposals.length > 0 && (
        <Card title="Proposed" tools={<span className="muted">{result.summary}</span>}>
          <div className="stack">
            {result.proposals.map((p) => (
              <div key={p.id} className="agents__proposal">
                <div className="stack agents__proposaltext">
                  <strong>{p.title}</strong>
                  <span className="muted">{p.why}</span>
                </div>
                <button type="button" className="btn btn--sm" onClick={() => onApply(p)}>
                  {p.kind === 'remember' ? 'Keep it' : 'Add task'}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Passages (${result.passages.length})`}>
        <div className="stack">
          {result.passages.map((p) => (
            <button key={p.id} type="button" className="agents__passage" onClick={() => onOpen?.(p.id)}>
              <span className="agents__ptitle">{p.title}</span>
              <span className="muted agents__pwhy">
                {p.kind === 'gene' ? 'claim' : p.entityType || p.kind}
                {' · '}relevance {p.why.relevance.toFixed(2)}
                {p.why.fitness !== null ? ` · fitness ${p.why.fitness.toFixed(2)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {result.critique.cut.length > 0 && (
        <Card title="Cut by the Critic">
          <div className="stack">
            {result.critique.cut.map((c, i) => (
              <div key={i} className="agents__cut">
                <span>{c.claim}</span>
                <span className="muted">{c.reason}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/** Citations become links to the record they point at. */
function renderCitations(text, byId, onOpen) {
  const parts = []
  const re = /\[\[([a-z0-9_-]+)\]\]/gi
  let at = 0
  let match = re.exec(text)
  let key = 0
  while (match) {
    if (match.index > at) parts.push(text.slice(at, match.index))
    const id = match[1]
    const passage = byId.get(id)
    parts.push(
      <button
        key={key += 1}
        type="button"
        className="cite"
        title={passage?.title || id}
        onClick={() => onOpen?.(id)}
      >{passage ? shorten(passage.title) : id}</button>,
    )
    at = match.index + match[0].length
    match = re.exec(text)
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

const shorten = (title) => (title.length > 28 ? `${title.slice(0, 26)}…` : title)

/* ---------------------------------------------------------------- study */

const GRADES = [
  { score: 1, label: 'Again', tone: 'critical' },
  { score: 3, label: 'Hard', tone: 'warning' },
  { score: 4, label: 'Good', tone: '' },
  { score: 5, label: 'Easy', tone: 'good' },
]

function Study({ queue, counts, cards, onToast }) {
  const [shown, setShown] = useState(false)
  const card = queue[0]

  const answer = (score) => {
    const next = grade(card.id, score)
    setShown(false)
    if (next && score < 3) onToast?.('Back in the queue today.', 'warning')
  }

  if (!cards.length) {
    return <Empty title="Nothing to study yet" hint="Ask the agents something. Cards are cut from the passages they find, so the queue fills from what you actually read." />
  }
  if (!card) {
    return (
      <Card title="Nothing due">
        <p className="muted" style={{ margin: 0 }}>
          {counts.total} card{counts.total === 1 ? '' : 's'}, {counts.learned} learned. The next one is scheduled for later — that is the schedule working, not a bug.
        </p>
      </Card>
    )
  }

  return (
    <div className="stack">
      <div className="agents__progress">
        <span><strong>{counts.due}</strong> due</span>
        <span><strong>{counts.learned}</strong> learned</span>
        <span><strong>{counts.total}</strong> total</span>
        {counts.lapsing > 0 && <span className="agents__lapsing"><strong>{counts.lapsing}</strong> keep slipping</span>}
      </div>

      <div className="agents__card">
        <p className="agents__question">{card.question}</p>
        {shown ? (
          <>
            <p className="agents__reveal">{card.answer}</p>
            <div className="row row--wrap">
              {GRADES.map((g) => (
                <button key={g.score} type="button" className={`btn ${g.tone ? `btn--${g.tone}` : ''}`} onClick={() => answer(g.score)}>
                  {g.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => setShown(true)}>Show the answer</button>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- genome */

function Genome({ population, onToast, onOpen }) {
  const [showRetired, setShowRetired] = useState(false)
  const visible = population
    .filter((g) => showRetired || !g.retired)
    .sort((a, b) => explainFitness(b).fitness - explainFitness(a).fitness)

  const runPrune = () => {
    const { retired, revived } = prune()
    onToast?.(
      retired.length || revived.length
        ? `${retired.length} retired, ${revived.length} revived.`
        : 'Nothing has fallen below the floor.',
      'good',
    )
  }

  if (!population.length) {
    return <Empty title="The genome is empty" hint="Claims arrive when the agents find the same thing said by more than one source and you keep it, or when you write one yourself." />
  }

  return (
    <div className="stack">
      <div className="row row--wrap agents__genomebar">
        <span className="muted">{population.filter((g) => !g.retired).length} live, {population.filter((g) => g.retired).length} retired</span>
        <label className="row agents__toggle">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
        <button type="button" className="btn btn--sm" onClick={runPrune}><IconRefresh width={12} height={12} /> Run selection</button>
      </div>

      <div className="stack">
        {visible.map((gene) => <Gene key={gene.id} gene={gene} onToast={onToast} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function Gene({ gene, onToast, onOpen }) {
  const parts = explainFitness(gene)
  const pct = (n) => `${Math.round(n * 100)}%`

  return (
    <div className={`agents__gene${gene.retired ? ' is-retired' : ''}`}>
      <div className="agents__genehead">
        <button type="button" className="agents__geneclaim" onClick={() => onOpen?.(gene.id)}>{gene.claim}</button>
        <span className="agents__gen" title={`Generation ${gene.generation}`}>gen {gene.generation}</span>
      </div>

      <div className="agents__fitness" title={`support ${pct(parts.support)} · cited ${gene.cited} · recency ${pct(parts.recency)}`}>
        <div className="agents__fitbar"><div className="agents__fitfill" style={{ width: pct(parts.fitness) }} /></div>
        <span className="muted">{pct(parts.fitness)}</span>
      </div>

      <div className="agents__genemeta muted">
        {gene.confirmed} confirmed · {gene.contradicted} contradicted · {gene.cited} cited
        {gene.parents.length ? ` · descended from ${gene.parents.length} earlier version${gene.parents.length === 1 ? '' : 's'}` : ''}
        {gene.retired ? ' · retired' : ''}
      </div>

      <div className="row row--wrap agents__geneactions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { agree(gene.id); onToast?.('Confirmed.', 'good') }}>
          <IconCheck width={12} height={12} /> Still true
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { disagree(gene.id); onToast?.('Recorded against it.', 'warning') }}>
          Not any more
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { forget(gene.id); onToast?.('Deleted.', 'warning') }}>
          <IconTrash width={12} height={12} /> Delete
        </button>
      </div>
    </div>
  )
}
