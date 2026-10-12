import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, BookMarked, Check, CheckCircle2, ClipboardList,
  Clock3, Copy, Cpu, Download, FileClock, Gauge, Highlighter, Link2, MessageSquareText,
  PencilLine, Play, Plus, Save, Send, Sparkles, Trash2, UserRound, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import {
  createShare, deleteTranscript, exportUrl, getTranscript, getTranscriptAudio,
  createActionItem, deliverTranscript, getIntegrations,
  listGlossary, listTranscriptRevisions, removeGlossaryTerm, renameTranscriptSpeaker,
  saveGlossaryTerm, updateTranscript,
} from '../../utils/apiClient'

const splitLines = (text = '') => text.split(/\n+/).map(line => line.trim()).filter(Boolean)
const formatTime = seconds => {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const remainder = Math.floor(value % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function deriveInsights(transcript) {
  const result = transcript?.result
  const structured = result && typeof result === 'object' ? result : null
  const resultText = typeof result === 'string' ? result : result ? JSON.stringify(result, null, 2) : ''
  const text = transcript?.text || ''
  const lines = splitLines(resultText || text)
  return {
    summary: structured?.summary || resultText || splitLines(text).slice(0, 5).join('\n\n') || 'No summary is available yet.',
    actions: structured?.actionItems?.map(item => [item.task, item.owner && `Owner: ${item.owner}`, item.dueDate && `Due: ${item.dueDate}`].filter(Boolean).join(' · '))
      || lines.filter(line => /action|todo|follow|owner|due|\[ \]/i.test(line)).slice(0, 8),
    decisions: structured?.decisions || lines.filter(line => /decision|decided|agreed|approved/i.test(line)).slice(0, 6),
    risks: structured?.risks || [],
    followUps: structured?.followUps || [],
    chapters: structured?.chapters || [],
    soundbites: (transcript?.segments || [])
      .filter(segment => segment.text.length > 70)
      .slice(0, 5),
  }
}

export default function TranscriptDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const audioRef = useRef(null)
  const [transcript, setTranscript] = useState(null)
  const [tab, setTab] = useState('transcript')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareDays, setShareDays] = useState('7')
  const [audioUrl, setAudioUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftSegments, setDraftSegments] = useState([])
  const [saving, setSaving] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [glossary, setGlossary] = useState([])
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [speakerDrafts, setSpeakerDrafts] = useState({})
  const [integrations, setIntegrations] = useState(null)
  const [deliveryAdapter, setDeliveryAdapter] = useState('local')
  const [deliveryFormat, setDeliveryFormat] = useState('md')
  const [recipient, setRecipient] = useState('')
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const [actionTask, setActionTask] = useState('')
  const [actionOwner, setActionOwner] = useState('')
  const [actionDue, setActionDue] = useState('')

  const load = async () => {
    const next = await getTranscript(id)
    setTranscript(next)
    setDraftText(next.text || '')
    setDraftSegments((next.segments || []).map(segment => ({ ...segment })))
  }

  useEffect(() => {
    load().catch(err => setError(err.message))
    listTranscriptRevisions(id).then(setRevisions).catch(() => {})
    listGlossary().then(setGlossary).catch(() => {})
    getIntegrations().then(next => {
      setIntegrations(next)
      const first = Object.entries(next.adapters || {}).find(([, active]) => active)?.[0]
      if (first) setDeliveryAdapter(first)
    }).catch(() => {})
    let objectUrl = ''
    getTranscriptAudio(id).then(url => { objectUrl = url; setAudioUrl(url) }).catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id])

  useEffect(() => {
    const at = Number(searchParams.get('at'))
    if (!Number.isFinite(at) || at < 0 || !transcript) return
    setTab('transcript')
    if (audioRef.current) audioRef.current.currentTime = at
    const closest = (transcript.segments || []).reduce((best, segment) => (
      Math.abs(segment.start - at) < Math.abs((best?.start ?? Infinity) - at) ? segment : best
    ), null)
    if (closest) requestAnimationFrame(() => document.getElementById(`segment-${Math.round(closest.start * 1000)}`)?.scrollIntoView({ block: 'center' }))
  }, [searchParams, transcript, audioUrl])

  const insights = useMemo(() => deriveInsights(transcript), [transcript])
  const speakers = useMemo(
    () => [...new Set((transcript?.segments || []).map(segment => segment.speaker).filter(Boolean))],
    [transcript],
  )
  const quality = transcript?.quality_meta || {}
  const sttRuntime = transcript?.processing_meta || {}
  const llmRuntime = transcript?.processing_meta?.llm

  const seek = seconds => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Number(seconds) || 0
    audioRef.current.play().catch(() => {})
  }

  const copy = async () => {
    await navigator.clipboard.writeText(transcript.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const share = async () => {
    const value = await createShare(id, shareDays ? Number(shareDays) : undefined)
    const url = `${window.location.origin}/share/${value.token}`
    await navigator.clipboard.writeText(url)
    setShareUrl(url)
  }

  const deliver = async () => {
    setError(''); setDeliveryMessage('')
    try {
      const delivery = await deliverTranscript(id, {
        adapter: deliveryAdapter, format: deliveryFormat,
        recipient: deliveryAdapter === 'email' ? recipient : undefined,
      })
      setDeliveryMessage(`Sent to ${delivery.destination}`)
    } catch (err) { setError(err.message) }
  }

  const addAction = async event => {
    event.preventDefault()
    if (!actionTask.trim()) return
    try {
      const next = await createActionItem(id, {
        task: actionTask.trim(), owner: actionOwner.trim() || undefined,
        dueDate: actionDue || undefined,
      })
      setTranscript(next.transcript)
      setActionTask(''); setActionOwner(''); setActionDue('')
    } catch (err) { setError(err.message) }
  }

  const remove = async () => {
    if (!window.confirm('Delete this transcript permanently?')) return
    await deleteTranscript(id)
    navigate('/library')
  }

  const saveCorrection = async () => {
    setSaving(true)
    setError('')
    try {
      const text = draftSegments.length ? draftSegments.map(segment => segment.text).join(' ').trim() : draftText
      const next = await updateTranscript(id, {
        text,
        segments: draftSegments.length ? draftSegments : undefined,
        reason: 'manual transcript correction',
      })
      setTranscript(next)
      setEditing(false)
      setRevisions(await listTranscriptRevisions(id))
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const renameSpeaker = async speaker => {
    const name = (speakerDrafts[speaker] || '').trim()
    if (!name || name === speaker) return
    try {
      const next = await renameTranscriptSpeaker(id, speaker, name)
      setTranscript(next)
      setDraftSegments((next.segments || []).map(segment => ({ ...segment })))
      setSpeakerDrafts(current => ({ ...current, [speaker]: '' }))
      setRevisions(await listTranscriptRevisions(id))
    } catch (err) { setError(err.message) }
  }

  const addGlossary = async event => {
    event.preventDefault()
    if (!term.trim() || !replacement.trim()) return
    try {
      await saveGlossaryTerm(term.trim(), replacement.trim())
      setGlossary(await listGlossary())
      setTerm('')
      setReplacement('')
    } catch (err) { setError(err.message) }
  }

  const deleteGlossary = async glossaryId => {
    await removeGlossaryTerm(glossaryId)
    setGlossary(await listGlossary())
  }

  if (error && !transcript) return <main className="flex-1 max-w-2xl mx-auto px-4 py-12"><p className="error-banner">{error}</p></main>
  if (!transcript) return <main className="flex-1 max-w-2xl mx-auto px-4 py-12"><p className="muted">Loading transcript...</p></main>

  const tabs = [
    ['transcript', 'Timeline', MessageSquareText],
    ['summary', 'Notes', Sparkles],
    ['actions', 'Actions', ClipboardList],
    ['soundbites', 'Highlights', Highlighter],
    ['history', 'History', FileClock],
  ]

  return (
    <main className="flex-1 w-full max-w-[92rem] mx-auto px-4 sm:px-6 py-6 lg:py-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm mb-4 muted">
        <ArrowLeft size={14} /> Notebook
      </button>

      <header className="transcript-masthead">
        <div className="min-w-0">
          <p className="eyebrow">{transcript.source} / {transcript.language || 'auto'}</p>
          <h1>{transcript.title}</h1>
          <div className="masthead-meta">
            <span><Clock3 size={13} /> {transcript.duration_sec ? `${Math.round(transcript.duration_sec / 60)} min` : 'duration n/a'}</span>
            <span>{transcript.task}</span>
            <span>{new Date(transcript.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="masthead-actions">
          <button className="icon-button p-2.5" onClick={copy} title="Copy transcript">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          {integrations?.sharing?.enabled !== false && <div className="share-control">
            <select value={shareDays} onChange={event => setShareDays(event.target.value)} title="Share expiration"><option value="1">1d</option><option value="7">7d</option><option value="30">30d</option><option value="">No expiry</option></select>
            <button className="icon-button p-2.5" onClick={share} title="Create share link"><Link2 size={16} /></button>
          </div>}
          <div className="export-menu">
            {['txt', 'md', 'json', 'actions.csv', 'srt', 'vtt'].map(format => (
              <a key={format} href={exportUrl(id, format)} download title={`Export ${format.toUpperCase()}`}>{format}</a>
            ))}
          </div>
          <button className="icon-button danger p-2.5" onClick={remove} title="Delete transcript"><Trash2 size={16} /></button>
        </div>
        {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="review-audio" />}
        {shareUrl && <div className="share-confirm"><CheckCircle2 size={14} /> Link copied</div>}
        {!!Object.values(integrations?.adapters || {}).some(Boolean) && (
          <div className="delivery-control">
            <Send size={14} />
            <select value={deliveryAdapter} onChange={event => setDeliveryAdapter(event.target.value)}>
              {Object.entries(integrations.adapters).filter(([, active]) => active).map(([key]) => <option key={key} value={key}>{key}</option>)}
            </select>
            <select value={deliveryFormat} onChange={event => setDeliveryFormat(event.target.value)}><option value="md">notes</option><option value="json">JSON</option><option value="actions.csv">actions</option></select>
            {deliveryAdapter === 'email' && <input type="email" value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Recipient" />}
            <button onClick={deliver}>Send</button>
            {deliveryMessage && <span>{deliveryMessage}</span>}
          </div>
        )}
      </header>

      {error && <div className="error-banner mt-4">{error}</div>}

      <div className="review-tabs mt-4" role="tablist">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} data-active={tab === key} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <section className="review-layout mt-4">
        <article className="review-canvas">
          {tab === 'transcript' && (
            <>
              <div className="canvas-toolbar">
                <div>
                  <p className="eyebrow">Review pass</p>
                  <h2>Timestamped transcript</h2>
                </div>
                {editing ? (
                  <div className="flex gap-2">
                    <button className="secondary-button compact" onClick={() => { setEditing(false); setDraftText(transcript.text); setDraftSegments((transcript.segments || []).map(item => ({ ...item }))) }}><X size={14} /> Cancel</button>
                    <button className="primary-button compact" disabled={saving} onClick={saveCorrection}><Save size={14} /> {saving ? 'Saving' : 'Save correction'}</button>
                  </div>
                ) : (
                  <button className="secondary-button compact" onClick={() => setEditing(true)}><PencilLine size={14} /> Correct</button>
                )}
              </div>

              {draftSegments.length ? (
                <div className="segment-list">
                  {draftSegments.map((segment, index) => {
                    const low = typeof segment.confidence === 'number' && segment.confidence < 0.65
                    return (
                      <div id={`segment-${Math.round(segment.start * 1000)}`} className="segment-row" data-low={low} key={`${segment.start}-${index}`}>
                        <button className="segment-time" onClick={() => seek(segment.start)} title="Play from this moment">
                          <Play size={11} /> {formatTime(segment.start)}
                        </button>
                        <div className="segment-copy">
                          {segment.speaker && <span className="speaker-label">{segment.speaker}</span>}
                          {editing ? (
                            <textarea
                              value={segment.text}
                              rows={Math.max(2, Math.ceil(segment.text.length / 80))}
                              onChange={event => setDraftSegments(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))}
                            />
                          ) : <p>{segment.text}</p>}
                        </div>
                        <div className="confidence-cell" title={segment.confidence == null ? 'Confidence unavailable' : `${Math.round(segment.confidence * 100)}% confidence`}>
                          {low && <AlertTriangle size={14} />}
                          <span>{segment.confidence == null ? '-' : `${Math.round(segment.confidence * 100)}%`}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : editing ? (
                <textarea className="full-transcript-editor" value={draftText} onChange={event => setDraftText(event.target.value)} />
              ) : <div className="prose-transcript">{transcript.text}</div>}
            </>
          )}

          {tab === 'summary' && (
            <div className="notes-sheet">
              <ReactMarkdown>{insights.summary}</ReactMarkdown>
              {!!insights.risks.length && <><h2>Risks</h2>{insights.risks.map((item, index) => <p className="decision-line" key={index}>{item}</p>)}</>}
              {!!insights.followUps.length && <><h2>Follow-ups</h2>{insights.followUps.map((item, index) => <p className="decision-line" key={index}>{item}</p>)}</>}
              {!!insights.chapters.length && <><h2>Chapters</h2>{insights.chapters.map((item, index) => <button className="highlight-line" key={index} onClick={() => seek(item.startSec || 0)}><span>{formatTime(item.startSec)}</span><strong>{item.title}</strong></button>)}</>}
            </div>
          )}

          {tab === 'actions' && (
            <div className="notes-sheet">
              <h2>Action items</h2>
              <form className="action-compose" onSubmit={addAction}>
                <input value={actionTask} onChange={event => setActionTask(event.target.value)} placeholder="New action item" />
                <input value={actionOwner} onChange={event => setActionOwner(event.target.value)} placeholder="Owner" />
                <input type="date" value={actionDue} onChange={event => setActionDue(event.target.value)} />
                <button title="Add action item"><Plus size={14} /></button>
              </form>
              {(insights.actions.length ? insights.actions : ['No explicit action items detected.']).map((item, index) => (
                <label className="action-line" key={index}><input type="checkbox" /><span>{item.replace(/^[-*]\s*/, '')}</span></label>
              ))}
              <h2 className="mt-8">Decisions</h2>
              {(insights.decisions.length ? insights.decisions : ['No explicit decisions detected.']).map((item, index) => <p className="decision-line" key={index}>{item}</p>)}
            </div>
          )}

          {tab === 'soundbites' && (
            <div className="highlight-stack">
              {(insights.soundbites.length ? insights.soundbites : [{ start: 0, text: 'No long highlight moments were detected.' }]).map((item, index) => (
                <button key={index} className="highlight-line" onClick={() => seek(item.start)}>
                  <span>{formatTime(item.start)}</span><q>{item.text}</q>
                </button>
              ))}
            </div>
          )}

          {tab === 'history' && (
            <div className="revision-ledger">
              <h2>Correction history</h2>
              {revisions.length ? revisions.map(revision => (
                <div key={revision.id}><FileClock size={15} /><span>{revision.reason}</span><time>{new Date(revision.created_at).toLocaleString()}</time></div>
              )) : <p className="muted mt-4">No manual corrections yet.</p>}
            </div>
          )}
        </article>

        <aside className="review-inspector">
          <section>
            <p className="inspector-title"><Gauge size={14} /> Signal quality</p>
            <div className="quality-score">
              <strong>{quality.averageConfidence == null ? '-' : `${Math.round(quality.averageConfidence * 100)}%`}</strong>
              <span>mean confidence</span>
            </div>
            <dl className="quality-list">
              <div><dt>Uncertain</dt><dd>{quality.lowConfidenceSegments || 0}</dd></div>
              <div><dt>Timed segments</dt><dd>{quality.timedSegments || transcript.segments?.length || 0}</dd></div>
              <div><dt>Speaker coverage</dt><dd>{Math.round((quality.diarizationCoverage || 0) * 100)}%</dd></div>
              <div><dt>Glossary hits</dt><dd>{quality.glossaryMatches || 0}</dd></div>
            </dl>
          </section>

          {sttRuntime.model && (
            <section>
              <p className="inspector-title"><Cpu size={14} /> Speech runtime</p>
              <dl className="quality-list">
                <div><dt>Backend</dt><dd>{sttRuntime.backend || '-'}</dd></div>
                <div><dt>Model</dt><dd>{sttRuntime.model}</dd></div>
                <div><dt>Device</dt><dd>{sttRuntime.device || 'auto'}</dd></div>
                <div><dt>STT runtime</dt><dd>{Number(sttRuntime.runtimeSec || 0).toFixed(2)}s</dd></div>
                <div><dt>Realtime factor</dt><dd>{Number(sttRuntime.realtimeFactor || 0).toFixed(2)}x</dd></div>
                <div><dt>Queue wait</dt><dd>{Number(sttRuntime.queueLatencySec || 0).toFixed(2)}s</dd></div>
              </dl>
            </section>
          )}

          {llmRuntime && (
            <section>
              <p className="inspector-title"><Sparkles size={14} /> Local enrichment</p>
              <dl className="quality-list">
                <div><dt>Adapter</dt><dd>{llmRuntime.adapter}</dd></div>
                <div><dt>Model</dt><dd>{llmRuntime.model}</dd></div>
                <div><dt>Runtime</dt><dd>{(Number(llmRuntime.runtimeMs || 0) / 1000).toFixed(2)}s</dd></div>
                <div><dt>Prompt size</dt><dd>{llmRuntime.promptChars || 0} chars</dd></div>
                <div><dt>Data path</dt><dd>{llmRuntime.local ? 'local' : 'external'}</dd></div>
              </dl>
            </section>
          )}

          <section>
            <p className="inspector-title"><UserRound size={14} /> Speakers</p>
            {speakers.length ? speakers.map(speaker => (
              <div className="speaker-edit" key={speaker}>
                <span>{speaker}</span>
                <input value={speakerDrafts[speaker] || ''} placeholder="Name" onChange={event => setSpeakerDrafts(current => ({ ...current, [speaker]: event.target.value }))} />
                <button onClick={() => renameSpeaker(speaker)} title="Save speaker name"><Check size={14} /></button>
              </div>
            )) : <p className="text-xs muted">Run with speaker labels to identify turns.</p>}
          </section>

          <section>
            <p className="inspector-title"><BookMarked size={14} /> Vocabulary</p>
            <form className="glossary-form" onSubmit={addGlossary}>
              <input value={term} onChange={event => setTerm(event.target.value)} placeholder="Heard as" />
              <input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="Write as" />
              <button title="Add glossary term"><Plus size={15} /></button>
            </form>
            <div className="glossary-list">
              {glossary.slice(0, 8).map(item => (
                <div key={item.id}><span>{item.term}</span><strong>{item.replacement}</strong><button onClick={() => deleteGlossary(item.id)}><Trash2 size={12} /></button></div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
