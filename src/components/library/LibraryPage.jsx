import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight, Bookmark, Bot, CalendarRange, Check, ChevronRight, Database,
  FileAudio, Filter, Folder, FolderPlus, Hash, LoaderCircle, Mic, Plus, Radio,
  Save, Search, Sparkles, Trash2, Users, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import {
  askKnowledge, deleteCollection, deleteSavedSearch, listCollections, listSavedSearches,
  saveCollection, saveSearch, searchKnowledge, updateTranscript,
} from '../../utils/apiClient'

const SOURCE_ICON = {
  upload: FileAudio, live: Radio, meeting: Users, dictation: Mic, folder: Folder,
  api: Database, desktop: Radio, extension: Mic,
}
const emptyFilters = { q: '', mode: 'keyword', source: '', task: '', speaker: '', tags: '', collectionId: '', dateFrom: '', dateTo: '' }

const formatTime = seconds => seconds == null ? '' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export default function LibraryPage() {
  const [filters, setFilters] = useState(emptyFilters)
  const [rows, setRows] = useState([])
  const [collections, setCollections] = useState([])
  const [savedSearches, setSavedSearches] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [saveName, setSaveName] = useState('')
  const [bulkCollection, setBulkCollection] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asking, setAsking] = useState(false)

  const reloadNavigation = async () => {
    const [nextCollections, nextSaved] = await Promise.all([listCollections(), listSavedSearches()])
    setCollections(nextCollections); setSavedSearches(nextSaved)
  }

  useEffect(() => { reloadNavigation().catch(err => setError(err.message)) }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true); setError('')
      searchKnowledge(filters).then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false))
    }, filters.q ? 280 : 0)
    return () => clearTimeout(timer)
  }, [filters])

  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected])

  const updateFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const toggleSelected = id => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const createCollection = async event => {
    event.preventDefault()
    if (!collectionName.trim()) return
    await saveCollection(collectionName.trim())
    setCollectionName('')
    await reloadNavigation()
  }

  const removeCollection = async id => {
    await deleteCollection(id)
    if (filters.collectionId === id) updateFilter('collectionId', '')
    await reloadNavigation()
  }

  const createSavedSearch = async event => {
    event.preventDefault()
    if (!saveName.trim()) return
    await saveSearch(saveName.trim(), filters)
    setSaveName('')
    await reloadNavigation()
  }

  const applyBulk = async () => {
    const patch = {}
    if (bulkCollection) patch.collectionId = bulkCollection
    if (bulkTags.trim()) patch.tags = bulkTags.split(',').map(tag => tag.trim()).filter(Boolean)
    if (!Object.keys(patch).length || !selectedRows.length) return
    await Promise.all(selectedRows.map(row => updateTranscript(row.id, patch)))
    setSelected(new Set()); setBulkTags('')
    setRows(await searchKnowledge(filters)); await reloadNavigation()
  }

  const ask = async event => {
    event.preventDefault()
    if (!question.trim()) return
    setAsking(true); setError(''); setAnswer(null)
    try {
      setAnswer(await askKnowledge({
        question: question.trim(),
        transcriptIds: selected.size ? [...selected] : undefined,
        collectionId: !selected.size && filters.collectionId ? filters.collectionId : undefined,
      }))
    } catch (err) { setError(err.message) }
    finally { setAsking(false) }
  }

  return (
    <main className="flex-1 knowledge-shell">
      <aside className="knowledge-nav">
        <div className="knowledge-brand"><Database size={16} /><span>Memory index</span></div>
        <button className="collection-link" data-active={!filters.collectionId} onClick={() => updateFilter('collectionId', '')}>
          <Folder size={14} /><span>All transcripts</span><strong>{rows.length}</strong>
        </button>
        <div className="nav-section-title">Collections</div>
        {collections.map(collection => (
          <div className="collection-row" key={collection.id}>
            <button className="collection-link" data-active={filters.collectionId === collection.id} onClick={() => updateFilter('collectionId', collection.id)}>
              <i style={{ background: collection.color }} /><span>{collection.name}</span><strong>{collection.transcript_count}</strong>
            </button>
            <button onClick={() => removeCollection(collection.id)} title="Delete collection"><X size={12} /></button>
          </div>
        ))}
        <form className="nav-create" onSubmit={createCollection}>
          <FolderPlus size={14} /><input value={collectionName} onChange={event => setCollectionName(event.target.value)} placeholder="New collection" />
          <button title="Create collection"><Plus size={13} /></button>
        </form>

        <div className="nav-section-title">Saved views</div>
        {savedSearches.map(saved => (
          <div className="collection-row" key={saved.id}>
            <button className="collection-link" onClick={() => setFilters({ ...emptyFilters, ...saved.query })}>
              <Bookmark size={13} /><span>{saved.name}</span>
            </button>
            <button onClick={async () => { await deleteSavedSearch(saved.id); await reloadNavigation() }} title="Delete saved view"><X size={12} /></button>
          </div>
        ))}
        <form className="nav-create" onSubmit={createSavedSearch}>
          <Save size={14} /><input value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Save current view" />
          <button title="Save search"><Plus size={13} /></button>
        </form>
      </aside>

      <section className="knowledge-main">
        <header className="knowledge-header">
          <div>
            <p className="eyebrow">Offline knowledge</p>
            <h1>Conversation memory</h1>
          </div>
          <div className="search-mode">
            {['keyword', 'semantic'].map(mode => <button key={mode} data-active={filters.mode === mode} onClick={() => updateFilter('mode', mode)}>{mode}</button>)}
          </div>
        </header>

        <div className="knowledge-search">
          <Search size={19} />
          <input value={filters.q} onChange={event => updateFilter('q', event.target.value)} placeholder={filters.mode === 'semantic' ? 'Search by meaning...' : 'Search exact meeting memory...'} />
          {filters.q && <button onClick={() => updateFilter('q', '')}><X size={15} /></button>}
        </div>

        <div className="filter-strip">
          <Filter size={14} />
          <select value={filters.source} onChange={event => updateFilter('source', event.target.value)}><option value="">All sources</option><option value="meeting">Meetings</option><option value="upload">Uploads</option><option value="folder">Watch folder</option><option value="api">API</option><option value="extension">Extension</option><option value="desktop">Desktop</option><option value="dictation">Dictation</option><option value="live">Live</option></select>
          <select value={filters.task} onChange={event => updateFilter('task', event.target.value)}><option value="">All tasks</option><option value="transcription">Transcript</option><option value="meeting">Meeting notes</option><option value="summary">Summary</option><option value="interview">Interview</option></select>
          <label><Users size={13} /><input value={filters.speaker} onChange={event => updateFilter('speaker', event.target.value)} placeholder="Speaker" /></label>
          <label><Hash size={13} /><input value={filters.tags} onChange={event => updateFilter('tags', event.target.value)} placeholder="Tags" /></label>
          <label><CalendarRange size={13} /><input type="date" value={filters.dateFrom} onChange={event => updateFilter('dateFrom', event.target.value)} /></label>
          <button className="filter-clear" onClick={() => setFilters(emptyFilters)}>Clear</button>
        </div>

        {!!selected.size && (
          <div className="bulk-strip">
            <Check size={14} /><span>{selected.size} selected</span>
            <select value={bulkCollection} onChange={event => setBulkCollection(event.target.value)}><option value="">Move to collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <input value={bulkTags} onChange={event => setBulkTags(event.target.value)} placeholder="tag, tag" />
            <button onClick={applyBulk}>Apply</button>
          </div>
        )}

        {error && <div className="error-banner mt-3">{error}</div>}
        <div className="result-summary"><span>{loading ? 'searching' : `${rows.length} result${rows.length === 1 ? '' : 's'}`}</span><span>{filters.mode} index</span></div>

        <div className="knowledge-results">
          {loading ? <LoaderCircle className="animate-spin m-8" /> : rows.map(row => {
            const Icon = SOURCE_ICON[row.source] || FileAudio
            return (
              <article className="knowledge-result" key={row.id} data-selected={selected.has(row.id)}>
                <button className="result-check" onClick={() => toggleSelected(row.id)} aria-label={`Select ${row.title}`}>{selected.has(row.id) && <Check size={12} />}</button>
                <div className="result-source"><Icon size={15} /><span>{row.source}</span></div>
                <div className="result-copy">
                  <Link to={`/t/${row.id}${row.location?.startSec != null ? `?at=${row.location.startSec}` : ''}`}><h2>{row.title}</h2></Link>
                  <p>{row.location?.excerpt || row.text?.slice(0, 220)}</p>
                  <div>{row.collection_name && <span><Folder size={11} /> {row.collection_name}</span>}{(row.tags || []).map(tag => <span key={tag}>#{tag}</span>)}<time>{new Date(row.created_at).toLocaleDateString()}</time></div>
                </div>
                {row.location?.startSec != null && <Link className="result-time" to={`/t/${row.id}?at=${row.location.startSec}`}>{formatTime(row.location.startSec)} <ChevronRight size={12} /></Link>}
                <Link className="result-open" to={`/t/${row.id}`}><ArrowUpRight size={15} /></Link>
              </article>
            )
          })}
          {!loading && !rows.length && <div className="knowledge-empty"><Database size={24} /><p>No indexed conversation matches this view.</p></div>}
        </div>
      </section>

      <aside className="ask-panel">
        <div className="ask-heading"><Bot size={17} /><div><span>Ask memory</span><small>{selected.size ? `${selected.size} selected sources` : filters.collectionId ? 'current collection' : 'best local matches'}</small></div></div>
        <form onSubmit={ask}>
          <textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="What did we decide about the launch?" />
          <button disabled={asking}>{asking ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />} Ask locally</button>
        </form>
        {answer && (
          <div className="answer-sheet">
            <ReactMarkdown>{answer.answer}</ReactMarkdown>
            <div className="answer-citations">
              {answer.citations.map((citation, index) => (
                <Link key={`${citation.transcriptId}-${index}`} to={`/t/${citation.transcriptId}${citation.startSec != null ? `?at=${citation.startSec}` : ''}`}>
                  <span>[{index + 1}]</span><strong>{citation.title}</strong><small>{citation.startSec == null ? '' : formatTime(citation.startSec)}</small>
                </Link>
              ))}
            </div>
          </div>
        )}
      </aside>
    </main>
  )
}
