import { useEffect, useState } from 'react'
import {
  Activity, Braces, Check, CircleAlert, Cpu, Gauge, LoaderCircle, Play,
  Save, Server, Sparkles, TimerReset,
} from 'lucide-react'
import { getLlmSettings, saveLlmSettings, testLlmSettings } from '../../utils/apiClient'

const defaultConfig = {
  adapter: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen2.5:3b',
  preset: { summary: true, decisions: true, actionItems: true, risks: true, followUps: true, chapters: true },
}

const presetLabels = {
  summary: 'Summary', decisions: 'Decisions', actionItems: 'Action items',
  risks: 'Risks', followUps: 'Follow-ups', chapters: 'Chapters',
}

export default function IntelligenceSettingsPage() {
  const [config, setConfig] = useState(defaultConfig)
  const [status, setStatus] = useState('loading')
  const [testResult, setTestResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getLlmSettings().then(value => { setConfig({ ...defaultConfig, ...value, preset: { ...defaultConfig.preset, ...value.preset } }); setStatus('ready') })
      .catch(err => { setError(err.message); setStatus('ready') })
  }, [])

  const updateAdapter = adapter => {
    setConfig(current => ({
      ...current,
      adapter,
      endpoint: adapter === 'ollama' ? 'http://127.0.0.1:11434' : adapter === 'llama-cpp' ? 'http://127.0.0.1:8081' : undefined,
      model: adapter === 'ollama' ? 'qwen2.5:3b' : adapter === 'llama-cpp' ? 'local-model' : 'claude-local',
    }))
    setTestResult(null)
  }

  const save = async () => {
    setStatus('saving'); setError('')
    try { await saveLlmSettings(config); setStatus('saved'); setTimeout(() => setStatus('ready'), 1500) }
    catch (err) { setError(err.message); setStatus('ready') }
  }

  const test = async () => {
    setStatus('testing'); setError(''); setTestResult(null)
    try { setTestResult(await testLlmSettings(config)); setStatus('ready') }
    catch (err) { setError(err.message); setStatus('ready') }
  }

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
      <header className="intelligence-masthead">
        <div>
          <p className="eyebrow">Local intelligence</p>
          <h1>Enrichment engine</h1>
          <p className="muted">Workspace preset and model routing</p>
        </div>
        <div className="engine-signal" data-ok={testResult?.ok || false}>
          <Activity size={17} />
          <span>{testResult?.ok ? 'endpoint verified' : 'awaiting check'}</span>
        </div>
      </header>

      {error && <div className="error-banner mt-4"><CircleAlert size={15} /> {error}</div>}

      <section className="intelligence-grid mt-5">
        <div className="engine-console">
          <div className="console-heading"><Server size={16} /><span>Runtime route</span></div>
          <div className="adapter-switch">
            {['ollama', 'llama-cpp', 'claude-local'].map(adapter => (
              <button key={adapter} data-active={config.adapter === adapter} onClick={() => updateAdapter(adapter)}>{adapter}</button>
            ))}
          </div>

          <label className="console-field">
            <span>Model</span>
            <input value={config.model} onChange={event => setConfig(current => ({ ...current, model: event.target.value }))} />
          </label>
          {config.adapter !== 'claude-local' && (
            <label className="console-field">
              <span>Private endpoint</span>
              <input value={config.endpoint || ''} onChange={event => setConfig(current => ({ ...current, endpoint: event.target.value }))} />
            </label>
          )}

          <div className="runtime-route" aria-hidden="true">
            <div><Braces size={17} /><span>transcript</span></div>
            <i />
            <div><Cpu size={17} /><span>{config.model}</span></div>
            <i />
            <div><Sparkles size={17} /><span>notes</span></div>
          </div>

          <div className="console-actions">
            <button className="secondary-button" onClick={test} disabled={status === 'testing'}>
              {status === 'testing' ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} />} Test
            </button>
            <button className="primary-button" onClick={save} disabled={status === 'saving'}>
              {status === 'saved' ? <Check size={15} /> : <Save size={15} />} {status === 'saved' ? 'Saved' : 'Save route'}
            </button>
          </div>
        </div>

        <div className="preset-console">
          <div className="console-heading"><Gauge size={16} /><span>Meeting output</span></div>
          <div className="preset-list">
            {Object.entries(presetLabels).map(([key, label], index) => (
              <label key={key}>
                <span className="preset-index">0{index + 1}</span>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={config.preset[key]}
                  onChange={event => setConfig(current => ({ ...current, preset: { ...current.preset, [key]: event.target.checked } }))}
                />
              </label>
            ))}
          </div>
        </div>

        <aside className="test-readout">
          <div className="console-heading"><TimerReset size={16} /><span>Last probe</span></div>
          {testResult ? (
            <>
              <strong>{testResult.runtime?.runtimeMs ? `${(testResult.runtime.runtimeMs / 1000).toFixed(2)}s` : 'ready'}</strong>
              <p>{testResult.output}</p>
              <dl>
                <div><dt>adapter</dt><dd>{testResult.runtime?.adapter || config.adapter}</dd></div>
                <div><dt>model</dt><dd>{testResult.runtime?.model || config.model}</dd></div>
                <div><dt>data path</dt><dd>local</dd></div>
              </dl>
            </>
          ) : <p className="muted">Run a probe to verify model reachability and response time.</p>}
        </aside>
      </section>
    </main>
  )
}
