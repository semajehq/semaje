import { useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppContext } from '../../context/AppContext'
import { Building2, Check, FileAudio, Mic, MonitorSpeaker, Puzzle, Search, ShieldCheck } from 'lucide-react'

const useCases = [
  { id: 'meetings', label: 'Meetings', detail: 'Calls, decisions, action items' },
  { id: 'dictation', label: 'Dictation', detail: 'Notes into any text box' },
  { id: 'research', label: 'Research', detail: 'Interviews, field notes, clips' },
  { id: 'operations', label: 'Operations', detail: 'Reusable transcripts and exports' },
]

const sources = [
  { id: 'uploads', label: 'File uploads', Icon: FileAudio },
  { id: 'dictation', label: 'Live dictation', Icon: Mic },
  { id: 'meetings', label: 'Meeting capture', Icon: MonitorSpeaker },
  { id: 'extension', label: 'Browser extension', Icon: Puzzle },
]

export default function OnboardingPage() {
  const { onboarding, completeOnboarding, account } = useContext(AppContext)
  const navigate = useNavigate()
  const [workspaceName, setWorkspaceName] = useState(onboarding.workspaceName || account.workspaceName)
  const [primaryUse, setPrimaryUse] = useState(onboarding.primaryUse || 'meetings')
  const [captureSources, setCaptureSources] = useState(onboarding.captureSources || ['uploads', 'dictation'])
  const [extensionInterest, setExtensionInterest] = useState(onboarding.extensionInterest ?? true)

  const selectedUse = useMemo(() => useCases.find(item => item.id === primaryUse), [primaryUse])

  const toggleSource = (id) => {
    setCaptureSources(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id],
    )
  }

  const finish = () => {
    completeOnboarding({
      workspaceName: workspaceName.trim() || account.workspaceName,
      primaryUse,
      captureSources,
      extensionInterest,
    })
    navigate('/', { replace: true })
  }

  return (
    <main className="min-h-[calc(100vh-5rem)] w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] items-start">
        <div className="app-panel p-6 sm:p-8">
          <div className="eyebrow">Welcome to semaje</div>
          <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.02] break-words max-w-[10ch] sm:max-w-xl">
            Set up the workspace before the first transcript.
          </h1>
          <p className="mt-5 text-base leading-7 muted max-w-[30ch] sm:max-w-xl">
            semaje is your self-hosted meeting assistant: capture calls, generate summaries and action items,
            share highlights, and build a searchable memory of team conversations.
          </p>

          <div className="mt-8 grid gap-3">
            {[
              [ShieldCheck, account.mode === 'single-user' ? 'Single-user auth is enabled' : 'Team login is enabled'],
              [Search, 'Transcript search and exports are available'],
              [Puzzle, extensionInterest ? 'Extension onboarding will stay visible' : 'Extension can be added later'],
            ].map(([Icon, label]) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <Icon size={17} style={{ color: 'var(--accent)' }} />
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="app-panel p-5 sm:p-6">
          <div className="form-section">
            <label className="field-label" htmlFor="workspaceName">Workspace</label>
            <div className="field-row">
              <Building2 size={17} style={{ color: 'var(--muted)' }} />
              <input
                id="workspaceName"
                className="field-input"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="Workspace name"
              />
            </div>
          </div>

          <div className="form-section">
            <div className="field-label">Primary workflow</div>
            <div className="choice-grid">
              {useCases.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPrimaryUse(item.id)}
                  className="choice-card"
                  data-active={primaryUse === item.id}
                >
                  <span className="choice-title">{item.label}</span>
                  <span className="choice-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="field-label">Capture sources</div>
            <div className="source-list">
              {sources.map(({ id, label, Icon }) => {
                const active = captureSources.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSource(id)}
                    className="source-toggle"
                    data-active={active}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                    {active && <Check size={15} className="ml-auto" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="form-section">
            <div className="field-label">Runtime</div>
            <div className="runtime-card">
              <div>
                <div className="text-sm font-semibold">Fully local, fully open source</div>
                <p className="text-xs muted mt-1">
                  Speech recognition (Whisper + Omnilingual ASR, 1,600+ languages) and text-to-speech
                  (Piper) run on your own server. No audio leaves your infrastructure.
                </p>
              </div>
            </div>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={extensionInterest}
              onChange={e => setExtensionInterest(e.target.checked)}
            />
            <span>Keep extension setup visible after onboarding</span>
          </label>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <button type="button" className="primary-button" onClick={finish}>
              Enter {workspaceName.trim() || account.workspaceName}
            </button>
            <p className="text-xs muted">
              Optimized for {selectedUse?.label.toLowerCase()} with {captureSources.length} source{captureSources.length === 1 ? '' : 's'}.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
