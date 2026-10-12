import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check, Cpu, Download, Gauge, HardDrive, LoaderCircle, MemoryStick,
  RefreshCw, ServerCog, Trash2, Zap,
} from 'lucide-react'
import {
  activateSttModel, deleteSttModel, downloadSttModel, getSttRuntime,
} from '../../utils/apiClient'

const BACKENDS = [
  { id: 'faster-whisper', label: 'Whisper', hint: '99 languages · word timing · translation' },
  { id: 'whisper.cpp', label: 'whisper.cpp', hint: 'Whisper on Metal/CPU via native binary' },
  { id: 'omnilingual', label: 'Omnilingual ASR', hint: '1,600+ languages · low-resource coverage' },
]

const rankLabel = id => {
  if (id === 'large-v3') return 'LV3'
  if (id === 'large-v3-turbo') return 'LVT'
  const omni = id.match(/omniASR_(CTC|LLM)_(\d+[MB])/)
  if (omni) return `${omni[1][0]}${omni[2]}`
  return id.slice(0, 2).toUpperCase()
}

const formatSize = bytes => {
  if (!bytes) return 'not cached'
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes > 1024 ** 3 ? 0 : 1)} MB cached`
}

export default function ModelManagerPage() {
  const [runtime, setRuntime] = useState(null)
  const [backend, setBackend] = useState('faster-whisper')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setRuntime(await getSttRuntime()) }
    catch (err) { setError(err.message) }
  }, [])

  useEffect(() => { load() }, [load])

  const models = useMemo(
    () => runtime?.models?.filter(model => model.backend === backend) || [],
    [runtime, backend],
  )

  const act = async (key, operation) => {
    setBusy(key)
    setError('')
    try { await operation(); await load() }
    catch (err) { setError(err.message) }
    finally { setBusy('') }
  }

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
      <section className="app-panel p-5 sm:p-6 overflow-hidden runtime-hero">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div>
            <p className="eyebrow">Local speech engines</p>
            <h1 className="mt-2 text-3xl font-semibold">Model workshop</h1>
            <p className="mt-2 text-sm muted max-w-2xl">
              Two open-source engine families run side by side: Whisper for the languages it handles best,
              Omnilingual ASR for 1,600+ languages including low-resource ones. Requests are routed per
              language automatically. Models never leave this deployment.
            </p>
          </div>
          <button className="icon-button p-2.5" onClick={load} title="Refresh runtime">
            <RefreshCw size={16} />
          </button>
        </div>

        {runtime && (
          <div className="runtime-readout mt-6">
            <div><Cpu size={16} /><span>{runtime.hardware.cpuCount} CPU cores</span></div>
            <div><MemoryStick size={16} /><span>{Math.round(runtime.hardware.ramMb / 1024)} GB RAM</span></div>
            <div><Zap size={16} /><span>{runtime.hardware.device} / {runtime.hardware.computeType}</span></div>
            <div><Gauge size={16} /><span>{runtime.queue.workerSlots} worker slot{runtime.queue.workerSlots === 1 ? '' : 's'}</span></div>
          </div>
        )}
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="segmented-control" aria-label="Speech backend">
          {BACKENDS.map(item => (
            <button key={item.id} title={item.hint} data-active={backend === item.id} onClick={() => setBackend(item.id)}>{item.label}</button>
          ))}
        </div>
        {runtime && (
          <div className="text-xs muted font-mono">
            whisper: {runtime.activeByFamily?.whisper?.backend || runtime.active.backend} / {runtime.activeByFamily?.whisper?.model || runtime.active.model}
            {runtime.activeByFamily?.omnilingual && <> · omnilingual: {runtime.activeByFamily.omnilingual.model}</>}
          </div>
        )}
      </div>

      {error && <div className="error-banner mt-4">{error}</div>}

      {!runtime ? (
        <div className="app-panel mt-4 p-10 flex justify-center"><LoaderCircle className="animate-spin" /></div>
      ) : (
        <section className="model-ledger mt-4">
          {models.map(model => {
            const key = `${model.backend}:${model.id}`
            const pending = busy === key
            const recommended = model.family === 'omnilingual'
              ? runtime.hardware.recommendedOmnilingualModel === model.id
              : runtime.hardware.recommendedModel === model.id
            return (
              <article className="model-row" key={key} data-active={model.active}>
                <div className="model-rank">{rankLabel(model.id)}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold">{model.label}</h2>
                    {model.active && <span className="status-chip success"><Check size={11} /> active</span>}
                    {recommended && <span className="status-chip">recommended</span>}
                    {model.license && <span className="status-chip" title={model.license.url}>{model.license.spdx}</span>}
                    {model.languages && <span className="status-chip">{model.languages.toLocaleString()} languages</span>}
                    {model.available === false && <span className="status-chip">engine not installed on server</span>}
                  </div>
                  <div className="model-specs mt-2">
                    <span><HardDrive size={13} /> {model.diskMb >= 1000 ? `${model.diskMb / 1000} GB` : `${model.diskMb} MB`}</span>
                    <span><MemoryStick size={13} /> {(model.ramMb / 1000).toFixed(model.ramMb % 1000 ? 1 : 0)} GB RAM</span>
                    <span><Gauge size={13} /> {model.speed}</span>
                    <span><ServerCog size={13} /> {formatSize(model.cachedBytes)}</span>
                  </div>
                </div>
                <div className="model-accuracy">
                  <span className="text-xs muted">accuracy</span>
                  <strong>{model.accuracy}</strong>
                </div>
                <div className="model-actions">
                  {pending ? <LoaderCircle className="animate-spin" size={17} /> : (
                    <>
                      {!model.installed && model.available !== false && (
                        <button className="icon-button p-2" title={`Download ${model.label}`} onClick={() => act(key, () => downloadSttModel(model.backend, model.id))}>
                          <Download size={16} />
                        </button>
                      )}
                      {model.installed && !model.active && (
                        <button className="secondary-button compact" onClick={() => act(key, () => activateSttModel(model.backend, model.id))}>
                          <Zap size={14} /> Use
                        </button>
                      )}
                      {model.installed && !model.active && (
                        <button className="icon-button danger p-2" title={`Delete ${model.label}`} onClick={() => act(key, () => deleteSttModel(model.backend, model.id))}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}
