import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ask, isConfigured } from '../ai/assistant.js'
import { parseReply, plainText, visiblePortion } from '../ai/protocol.js'
import { applyProposal, describeProposal } from '../ai/apply.js'
import { resolve, PROVIDERS } from '../ai/providers.js'
import { updateAssistantSettings } from '../core/store.js'
import { Overlay } from './components.jsx'
import { IconClose, IconMic, IconSend, IconStop, IconSpark, IconSpeaker, IconCheck } from './icons.jsx'
import { useListen, speak, stopSpeaking, canSpeak } from './voice.js'

/**
 * The assistant panel.
 *
 * Every answer is grounded in the live store and cites the items it used;
 * every change it wants to make arrives as a proposal card that the user
 * applies or skips. The conversation lives here and only here: close the
 * panel and it is gone, which is the privacy model in one line.
 */

const SUGGESTIONS = [
  'What needs my attention today?',
  'What is late, and who owns it?',
  'Summarise this week\'s decisions',
  'What should I do first this morning?',
]

export function Assistant({ prefill, entities, state, range, onOpen, navigate, onClose, onToast }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState('')
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const partialRef = useRef('')
  const scrollRef = useRef(null)
  const sentPrefill = useRef(false)

  const settings = state.settings.assistant || {}
  const configured = isConfigured(settings)
  const target = resolve(settings)
  const speakReplies = Boolean(settings.speak) && canSpeak()

  const send = useCallback(async (question, { focus = [] } = {}) => {
    const text = String(question || '').trim()
    if (!text || busy) return
    setError(null)
    setInput('')
    stopSpeaking()
    const history = messages.map((m) => ({ role: m.role, content: m.role === 'assistant' ? m.raw : m.content }))
    setMessages((list) => [...list, { role: 'user', content: text }])
    setBusy(true)
    setPartial('')
    partialRef.current = ''
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const reply = await ask({
        question: text,
        history,
        entities,
        state,
        range,
        focus,
        signal: controller.signal,
        onDelta: (_, soFar) => { partialRef.current = soFar; setPartial(soFar) },
      })
      setMessages((list) => [...list, { role: 'assistant', raw: reply.raw, reply, decisions: {} }])
      if (speakReplies) {
        speak(plainText(reply.text), { onEnd: () => { if (settings.handsFree) listen.start() } })
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
      else if (partialRef.current) {
        const cut = partialRef.current
        setMessages((list) => [...list, { role: 'assistant', raw: cut, reply: parseReply(cut, { known: entities }), decisions: {}, cut: true }])
      }
    } finally {
      abortRef.current = null
      setBusy(false)
      setPartial('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, messages, entities, state, range, speakReplies, settings.handsFree])

  const listen = useListen({
    onResult: (text) => {
      if (settings.handsFree) send(text)
      else setInput((v) => (v ? `${v} ${text}` : text))
    },
  })

  useEffect(() => {
    if (prefill?.question && !sentPrefill.current && configured) {
      sentPrefill.current = true
      send(prefill.question, { focus: prefill.focus || [] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, configured])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, partial])

  useEffect(() => () => { abortRef.current?.abort(); stopSpeaking() }, [])

  const decide = (index, actionIndex, outcome) => {
    setMessages((list) => list.map((m, i) => (i === index ? { ...m, decisions: { ...m.decisions, [actionIndex]: outcome } } : m)))
  }

  const apply = (index, actionIndex, action) => {
    try {
      const note = applyProposal(action, { navigate })
      decide(index, actionIndex, 'applied')
      onToast?.(note, 'good')
    } catch (err) {
      onToast?.(err.message, 'critical')
    }
  }

  const applyAll = (index, actions) => {
    actions.forEach((action, ai) => {
      if (messages[index].decisions[ai]) return
      apply(index, ai, action)
    })
  }

  const streaming = useMemo(() => (partial ? parseReply(visiblePortion(partial), { known: entities }) : null), [partial, entities])

  const submit = (event) => {
    event.preventDefault()
    if (busy) { abortRef.current?.abort(); return }
    send(input)
  }

  return (
    <Overlay onClose={onClose} labelledBy="assistant-title" className="sheet sheet--wide">
      <header className="sheet__head">
        <IconSpark className="muted" />
        <h2 id="assistant-title" className="card__title">Assistant</h2>
        <span className="chip mono" title={`${PROVIDERS[target.provider]?.label || target.provider} at ${target.baseUrl}`}>
          {target.model || 'no model'}
        </span>
        <div className="spacer" />
        {canSpeak() && (
          <button
            className="btn btn--icon"
            aria-pressed={speakReplies}
            title={speakReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
            aria-label={speakReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
            style={speakReplies ? { color: 'var(--accent)' } : undefined}
            onClick={() => { if (speakReplies) stopSpeaking(); updateAssistantSettings({ speak: !settings.speak }) }}
          >
            <IconSpeaker />
          </button>
        )}
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>

      <div className="sheet__body chat" ref={scrollRef}>
        {!configured && (
          <div className="bar-left bar-left--info stack" style={{ gap: 'var(--gap-2)' }}>
            <div style={{ fontWeight: 560 }}>Pick a model to talk to.</div>
            <p className="muted" style={{ margin: 0 }}>
              Claude through your own Anthropic key, any OpenAI-compatible endpoint, or a local Ollama. The key stays in this browser and never enters the workspace file.
            </p>
            <div className="row">
              <button className="btn btn--primary btn--sm" onClick={() => { navigate('settings'); onClose() }}>Set it up in Settings</button>
            </div>
          </div>
        )}

        {configured && !messages.length && !partial && (
          <div className="stack" style={{ gap: 'var(--gap-2)' }}>
            <p className="muted" style={{ margin: 0 }}>
              Answers come from what you have imported and cite the items they lean on. Ask for a change and you get a proposal to apply, never a silent edit.
            </p>
            <div className="row row--wrap" style={{ gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip chip--button" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="chat__msg chat__msg--user">{m.content}</div>
          ) : (
            <div key={i} className="chat__msg">
              <Reply segments={m.reply.segments} entities={entities} onOpen={onOpen} />
              {m.cut && <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>Stopped early.</div>}
              {m.reply.actions.length > 0 && (
                <div className="stack" style={{ gap: 'var(--gap-2)', marginTop: 'var(--gap-3)' }}>
                  <div className="row">
                    <span className="field__label">Proposed changes</span>
                    <div className="spacer" />
                    {m.reply.actions.length > 1 && m.reply.actions.some((_, ai) => !m.decisions[ai]) && (
                      <button className="btn btn--sm" onClick={() => applyAll(i, m.reply.actions)}>Apply all</button>
                    )}
                  </div>
                  {m.reply.actions.map((action, ai) => (
                    <Proposal
                      key={ai}
                      action={action}
                      entities={entities}
                      outcome={m.decisions[ai]}
                      onApply={() => apply(i, ai, action)}
                      onSkip={() => decide(i, ai, 'skipped')}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        ))}

        {streaming && (
          <div className="chat__msg" aria-live="polite">
            <Reply segments={streaming.segments} entities={entities} onOpen={onOpen} />
            <span className="chat__cursor" />
          </div>
        )}
        {busy && !partial && <div className="chat__msg muted">Thinking</div>}
        {error && <div className="bar-left bar-left--critical" style={{ color: 'var(--critical)' }}>{error}</div>}
      </div>

      <form className="sheet__foot chat__form" onSubmit={submit}>
        <textarea
          className="textarea chat__input"
          rows={2}
          placeholder={listen.listening ? (listen.interim || 'Listening') : configured ? 'Ask about your work, or tell it what to change' : 'Configure a model first'}
          value={input}
          disabled={!configured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) send(input) } }}
          aria-label="Message"
        />
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          {listen.supported && configured && (
            <button
              type="button"
              className="btn btn--icon"
              aria-pressed={listen.listening}
              aria-label={listen.listening ? 'Stop listening' : 'Speak your question'}
              title={settings.handsFree ? 'Hands-free: what you say is sent when you stop talking' : 'Speak your question'}
              style={listen.listening ? { color: 'var(--critical)' } : undefined}
              onClick={() => (listen.listening ? listen.stop() : listen.start())}
            >
              <IconMic />
            </button>
          )}
          <button type="submit" className="btn btn--icon btn--primary" aria-label={busy ? 'Stop' : 'Send'} disabled={!configured || (!busy && !input.trim())} style={{ borderColor: 'var(--accent)' }}>
            {busy ? <IconStop /> : <IconSend />}
          </button>
        </div>
      </form>
    </Overlay>
  )
}

/** Lightly formatted reply text with citations rendered as chips. */
function Reply({ segments, entities, onOpen }) {
  return (
    <div className="chat__text">
      {segments.map((seg, i) => {
        if (seg.ref) {
          const entity = entities[seg.ref]
          if (!entity) return null
          return (
            <button key={i} type="button" className="cite" onClick={() => onOpen?.(entity)} title={`${entity.type}: ${entity.title}`}>
              {entity.title.length > 42 ? `${entity.title.slice(0, 40)}…` : entity.title}
            </button>
          )
        }
        return <Text key={i} text={seg.text} />
      })}
    </div>
  )
}

function Text({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))
}

function Proposal({ action, entities, outcome, onApply, onSkip }) {
  const { title, detail, missing } = describeProposal(action, entities)
  return (
    <div className={`proposal${outcome ? ` proposal--${outcome}` : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 560 }}>{title}</div>
        {detail && <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{detail}</div>}
        {action.note && <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{action.note}</div>}
      </div>
      <div className="row" style={{ flex: 'none' }}>
        {outcome === 'applied' && <span className="chip chip--good"><IconCheck width={11} height={11} /> Applied</span>}
        {outcome === 'skipped' && <span className="chip">Skipped</span>}
        {!outcome && (
          <>
            <button className="btn btn--sm" onClick={onSkip}>Skip</button>
            <button className="btn btn--sm btn--primary" onClick={onApply} disabled={missing}>Apply</button>
          </>
        )}
      </div>
    </div>
  )
}
