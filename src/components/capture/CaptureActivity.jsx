import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Check, Clock3, FileAudio, FolderInput, LoaderCircle, Radio,
  RefreshCcw, TerminalSquare,
} from 'lucide-react'
import { listJobs, retryJob } from '../../utils/apiClient'

const SOURCE = {
  folder: [FolderInput, 'Folder'], api: [TerminalSquare, 'API'], live: [Radio, 'Live'],
  dictation: [Radio, 'Dictation'], extension: [Radio, 'Extension'], upload: [FileAudio, 'Upload'],
  desktop: [Radio, 'Desktop'], meeting: [Radio, 'Meeting'],
}

function statusIcon(status) {
  if (status === 'succeeded') return <Check size={13} />
  if (status === 'failed') return <AlertTriangle size={13} />
  if (status === 'running') return <LoaderCircle size={13} className="animate-spin" />
  return <Clock3 size={13} />
}

export default function CaptureActivity({ activeJobId }) {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(null)

  const refresh = useCallback(async () => {
    try { setJobs(await listJobs(20)); setError('') }
    catch (nextError) { setError(nextError.message) }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [refresh])

  const retry = async (id) => {
    setRetrying(id)
    try { await retryJob(id); await refresh() }
    catch (nextError) { setError(nextError.message) }
    finally { setRetrying(null) }
  }

  return (
    <aside className="capture-ledger" aria-label="Capture activity">
      <div className="capture-ledger-head">
        <div>
          <p className="eyebrow">Processing</p>
          <h2>Activity ledger</h2>
        </div>
        <button className="icon-button h-9 w-9 rounded-lg" onClick={refresh} title="Refresh jobs" aria-label="Refresh jobs">
          <RefreshCcw size={15} />
        </button>
      </div>
      {error && <div className="capture-ledger-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="capture-job-list">
        {jobs.map(job => {
          const input = job.input || {}
          const [Icon, sourceLabel] = SOURCE[input.source] || SOURCE.upload
          return (
            <div key={job.id} className={`capture-job ${job.id === activeJobId ? 'is-active' : ''}`}>
              <div className="capture-job-line" aria-hidden="true">
                <span style={{ width: `${Math.max(3, job.progress || 0)}%` }} />
              </div>
              <div className="capture-job-top">
                <span className={`job-state state-${job.status}`}>{statusIcon(job.status)} {job.status}</span>
                <span className="capture-source"><Icon size={12} /> {sourceLabel}</span>
              </div>
              <div className="capture-job-title">{input.title || 'Untitled recording'}</div>
              <div className="capture-job-meta">
                <span>{new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{job.progress || 0}%</span>
                {job.status === 'failed' && (
                  <button onClick={() => retry(job.id)} disabled={retrying === job.id} title="Retry failed job">
                    <RefreshCcw size={12} /> Retry
                  </button>
                )}
                {job.status === 'succeeded' && job.transcript_id && <Link to={`/t/${job.transcript_id}`}>Open</Link>}
              </div>
              {job.error && <p className="capture-job-error">{job.error}</p>}
            </div>
          )
        })}
        {!jobs.length && !error && <div className="capture-empty">No captures yet</div>}
      </div>
    </aside>
  )
}
