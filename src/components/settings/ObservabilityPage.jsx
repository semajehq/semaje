import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowUpRight, Boxes, Clock3, Cpu, Database,
  Gauge, HardDrive, RefreshCw, ServerCog, TimerReset, Waves,
} from 'lucide-react'
import { getObservability } from '../../utils/apiClient'

const duration = seconds => {
  const value = Number(seconds || 0)
  if (value < 1) return `${Math.round(value * 1000)}ms`
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)}s`
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
}

const bytes = value => {
  const size = Number(value || 0)
  if (size < 1024 ** 2) return `${Math.round(size / 1024)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(2)} GB`
}

export default function ObservabilityPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await getObservability()); setError('') }
    catch (nextError) { setError(nextError.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const cacheBytes = useMemo(() => (data?.modelCache?.models || []).reduce((sum, model) => sum + Number(model.cachedBytes || 0), 0), [data])
  const maxStorage = Math.max(1, ...(data?.storage?.sources || []).map(source => Number(source.bytes || 0)))
  const completed = Number(data?.queue?.succeeded || 0) + Number(data?.queue?.failed || 0)
  const successRate = completed ? Math.round(Number(data.queue.succeeded || 0) / completed * 100) : 100

  return (
    <main className="flex-1 telemetry-page">
      <header className="telemetry-mast reveal-in">
        <div><p className="eyebrow">Local operations telemetry</p><h1>Signal room</h1></div>
        <div className="telemetry-actions">
          <a href="/metrics" target="_blank" rel="noreferrer"><Waves size={14} /> Prometheus <ArrowUpRight size={12} /></a>
          <button onClick={load} title="Refresh telemetry"><RefreshCw size={15} /></button>
        </div>
      </header>

      {error && <div className="error-banner mt-4">{error}</div>}

      <section className="telemetry-scoreboard reveal-in stagger-1">
        <div><span><Activity size={15} /> Queue</span><strong>{data?.queue?.queued || 0}</strong><small>{data?.queue?.running || 0} processing now</small></div>
        <div><span><Clock3 size={15} /> Wait p95</span><strong>{duration(data?.queue?.p95LatencySec)}</strong><small>{duration(data?.queue?.averageLatencySec)} average</small></div>
        <div><span><TimerReset size={15} /> Process p95</span><strong>{duration(data?.queue?.p95ProcessingSec)}</strong><small>{duration(data?.queue?.averageProcessingSec)} average</small></div>
        <div><span><Gauge size={15} /> Success</span><strong>{successRate}%</strong><small>{data?.queue?.failed || 0} failed / {completed} finished</small></div>
        <div><span><HardDrive size={15} /> Footprint</span><strong>{bytes(data?.storage?.totalBytes)}</strong><small>{bytes(cacheBytes)} model cache</small></div>
      </section>

      <div className="telemetry-grid reveal-in stagger-2">
        <section className="queue-console">
          <div className="telemetry-heading"><div><p className="eyebrow">Latest work</p><h2>Queue ledger</h2></div><span>{data?.queue?.workerSlots || 1} worker slot</span></div>
          <div className="job-head"><span>Status</span><span>Job</span><span>Model</span><span>Wait</span><span>Runtime</span></div>
          {(data?.recentJobs || []).map(job => {
            const wait = job.started_at ? (new Date(job.started_at) - new Date(job.created_at)) / 1000 : 0
            const runtime = job.finished_at && job.started_at ? (new Date(job.finished_at) - new Date(job.started_at)) / 1000 : Number(job.processing_meta?.runtimeSec || 0)
            return <div className="job-row" key={job.id} data-status={job.status}>
              <span className="job-state"><i />{job.status}</span>
              <div><strong>{job.title || job.task || 'Transcription'}</strong><small>{job.source || 'api'} / attempt {job.attempts}</small></div>
              <code>{job.processing_meta?.model || 'pending'}</code><time>{duration(wait)}</time><time>{duration(runtime)}</time>
            </div>
          })}
          {!data?.recentJobs?.length && <div className="telemetry-empty">No jobs have entered this queue.</div>}
        </section>

        <aside className="telemetry-rail">
          <section>
            <div className="rail-title"><AlertTriangle size={14} /><span>Failure clusters</span></div>
            {(data?.failures || []).map((failure, index) => <div className="failure-line" key={`${failure.error}-${index}`}><strong>{failure.count}</strong><p>{failure.error}</p><time>{new Date(failure.last_seen).toLocaleDateString()}</time></div>)}
            {!data?.failures?.length && <div className="rail-ok">No recorded failures</div>}
          </section>
          <section>
            <div className="rail-title"><Cpu size={14} /><span>Compute route</span></div>
            {(data?.compute || []).map(model => <div className="compute-line" key={`${model.backend}:${model.model}`}><div><strong>{model.model}</strong><small>{model.backend} / {model.jobs} jobs</small></div><b>{model.realtimeFactor.toFixed(2)}x</b><time>{duration(model.runtimeSec)} CPU/GPU</time></div>)}
            {!data?.compute?.length && <div className="rail-ok">Awaiting completed jobs</div>}
          </section>
        </aside>
      </div>

      <div className="telemetry-lower reveal-in stagger-3">
        <section className="storage-console">
          <div className="telemetry-heading"><div><p className="eyebrow">Disk pressure</p><h2>Audio by source</h2></div><Database size={18} /></div>
          {(data?.storage?.sources || []).map(source => <div className="storage-line" key={source.source}>
            <span>{source.source}</span><div><i style={{ width: `${Math.max(2, Number(source.bytes) / maxStorage * 100)}%` }} /></div><strong>{bytes(source.bytes)}</strong><small>{source.blobs} blobs</small>
          </div>)}
          {!data?.storage?.sources?.length && <div className="telemetry-empty">No source audio is stored.</div>}
        </section>

        <section className="quality-console">
          <div className="telemetry-heading"><div><p className="eyebrow">Transcript signal</p><h2>Quality instruments</h2></div><Boxes size={18} /></div>
          <div className="quality-dials">
            <div><strong>{data?.quality?.averageConfidence == null ? '-' : `${Math.round(data.quality.averageConfidence * 100)}%`}</strong><span>mean confidence</span></div>
            <div><strong>{data?.quality?.diarizationCoverage == null ? '-' : `${Math.round(data.quality.diarizationCoverage * 100)}%`}</strong><span>speaker coverage</span></div>
            <div><strong>{data?.quality?.wer?.average == null ? '-' : `${(data.quality.wer.average * 100).toFixed(1)}%`}</strong><span>latest WER</span></div>
          </div>
          <dl className="quality-facts"><div><dt>Transcripts sampled</dt><dd>{data?.quality?.transcripts || 0}</dd></div><div><dt>Timed segments</dt><dd>{data?.quality?.timedSegments || 0}</dd></div><div><dt>Low-confidence segments</dt><dd>{data?.quality?.lowConfidenceSegments || 0}</dd></div><div><dt>WER fixture</dt><dd>{data?.quality?.wer ? `${data.quality.wer.model} / ${data.quality.wer.passed ? 'pass' : 'fail'}` : 'not run'}</dd></div></dl>
        </section>
      </div>

      <nav className="telemetry-foot"><ServerCog size={14} /><span>Scrape <code>/metrics</code> locally</span><Link to="/settings/models">Tune speech models <ArrowUpRight size={12} /></Link><Link to="/settings/platform">Security controls <ArrowUpRight size={12} /></Link></nav>
    </main>
  )
}
