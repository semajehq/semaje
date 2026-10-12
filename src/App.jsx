import { useState, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom'
import { Activity, FileAudio, FolderInput, Puzzle, Radio, TerminalSquare } from 'lucide-react'
import { AppContext, AppProvider } from './context/AppContext'
import Header from './components/Header'
import Instructions from './components/Instructions'
import TabSwitcher from './components/TabSwitcher'
import TaskSelector from './components/TaskSelector'
import DropZone from './components/DropZone'
import OptionsBar from './components/OptionsBar'
import LanguagePicker from './components/LanguagePicker'
import TranscriptOutput from './components/TranscriptOutput'
import LiveTranscription from './components/LiveTranscription'
import Footer from './components/Footer'
import LoginPage from './components/auth/LoginPage'
import InviteAcceptPage from './components/auth/InviteAcceptPage'
import LibraryPage from './components/library/LibraryPage'
import TranscriptDetailPage from './components/library/TranscriptDetailPage'
import SharePage from './components/library/SharePage'
import ApiKeysPage from './components/settings/ApiKeysPage'
import PlatformSettingsPage from './components/settings/PlatformSettingsPage'
import ModelManagerPage from './components/settings/ModelManagerPage'
import IntelligenceSettingsPage from './components/settings/IntelligenceSettingsPage'
import IntegrationsPage from './components/settings/IntegrationsPage'
import ObservabilityPage from './components/settings/ObservabilityPage'
import MeetingsPage from './components/meetings/MeetingsPage'
import OnboardingPage from './components/onboarding/OnboardingPage'
import CaptureActivity from './components/capture/CaptureActivity'
import { useTranscribe } from './hooks/useTranscribe'
import { useRealtimeTranscribe } from './hooks/useRealtimeTranscribe'

function TranscribeScreen() {
  const { account } = useContext(AppContext)
  const {
    transcript, status, error, loading, task, changeTask, options, setOptions,
    handleFile, savedId, jobId, language, setLanguage, engine, setEngine,
  } = useTranscribe()
  const realtimeLive = useRealtimeTranscribe()

  const [activeTab, setActiveTab] = useState('upload')

  const liveTranscribe = {
    isRecording: realtimeLive.isRecording,
    isProcessing: false,
    segments: realtimeLive.segments,
    error: realtimeLive.error,
    savedId: realtimeLive.savedId,
    startRecording: () => realtimeLive.start({ mode: 'dictation', title: `${account.workspaceName} dictation`, language }),
    stopRecording: realtimeLive.stop,
    clearSegments: realtimeLive.clear,
  }

  const handleTabChange = (tab) => {
    if (tab !== 'live' && liveTranscribe.isRecording) liveTranscribe.stopRecording()
    setActiveTab(tab)
  }

  return (
    <main className="capture-page flex-1 w-full max-w-[90rem] mx-auto px-4 sm:px-6 py-6 lg:py-8">
      <header className="capture-mast reveal-in">
        <div>
          <p className="eyebrow">{account.workspaceName}</p>
          <h1>Capture desk</h1>
        </div>
        <div className="capture-health"><span /> Local intake online</div>
      </header>

      <div className="capture-lanes reveal-in stagger-1" aria-label="Available capture lanes">
        <div className="capture-lane is-current"><FileAudio size={17} /><span>File</span><b>Drop or browse</b></div>
        <div className="capture-lane"><FolderInput size={17} /><span>Watch folder</span><b>data/watch</b></div>
        <div className="capture-lane"><TerminalSquare size={17} /><span>API</span><b>/api/ingest</b></div>
        <button className="capture-lane" onClick={() => handleTabChange('live')}><Radio size={17} /><span>Live</span><b>Realtime mic</b></button>
        <Link className="capture-lane" to="/settings/integrations"><Puzzle size={17} /><span>Extension</span><b>Browser fields</b></Link>
      </div>

      <section className="capture-console reveal-in stagger-2">
        <div className="capture-workbench">
          <div className="capture-workbench-head">
            <div>
              <p className="eyebrow">New capture</p>
              <h2>{activeTab === 'live' ? 'Live microphone' : 'Recording intake'}</h2>
            </div>
            <TabSwitcher activeTab={activeTab} onChange={handleTabChange} />
          </div>

          {activeTab === 'upload' && (
            <div className="capture-controls">
              <TaskSelector task={task} onTaskChange={changeTask} />
              <LanguagePicker language={language} onLanguage={setLanguage} engine={engine} onEngine={setEngine} disabled={loading} />
              <DropZone onFile={handleFile} disabled={loading} active={loading} />
              <OptionsBar task={task} options={options} onChange={setOptions} />
              {(loading || transcript || error) && (
                <TranscriptOutput transcript={transcript} status={status} error={error} loading={loading} savedId={savedId} />
              )}
            </div>
          )}

          {activeTab === 'live' && <LiveTranscription liveTranscribe={liveTranscribe} isBlocked={false} />}

          <div className="capture-signal" aria-hidden="true">
            <Activity size={14} />
            <div>{[24, 58, 36, 78, 44, 68, 30, 88, 42, 62, 34, 72, 48, 84, 38, 56].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
            <span>QUEUE</span>
          </div>
        </div>
        <CaptureActivity activeJobId={jobId} />
      </section>
    </main>
  )
}

function RequireAuth({ children }) {
  const { user, authReady, authRequired } = useContext(AppContext)
  const location = useLocation()
  if (!authReady) return null
  if (authRequired && !user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

function RequireOnboarding({ children }) {
  const { onboarding } = useContext(AppContext)
  const location = useLocation()
  if (!onboarding.completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" state={{ from: location }} replace />
  }
  return children
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex flex-col app-backdrop" style={{ background: 'var(--bg)' }}>
      <div className="ambient-grid" aria-hidden="true" />
      <div className="motion-trace" aria-hidden="true" />
      <Header />
      {children}
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Shell><LoginPage /></Shell>} />
          <Route path="/join" element={<Shell><InviteAcceptPage /></Shell>} />
          <Route path="/onboarding" element={<Shell><RequireAuth><OnboardingPage /></RequireAuth></Shell>} />
          <Route path="/share/:token" element={<Shell><SharePage /></Shell>} />
          <Route path="/" element={<Shell><RequireAuth><RequireOnboarding><TranscribeScreen /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/meetings" element={<Shell><RequireAuth><RequireOnboarding><MeetingsPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/library" element={<Shell><RequireAuth><RequireOnboarding><LibraryPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/t/:id" element={<Shell><RequireAuth><RequireOnboarding><TranscriptDetailPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/api-keys" element={<Shell><RequireAuth><RequireOnboarding><ApiKeysPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/platform" element={<Shell><RequireAuth><RequireOnboarding><PlatformSettingsPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/models" element={<Shell><RequireAuth><RequireOnboarding><ModelManagerPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/intelligence" element={<Shell><RequireAuth><RequireOnboarding><IntelligenceSettingsPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/integrations" element={<Shell><RequireAuth><RequireOnboarding><IntegrationsPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="/settings/observability" element={<Shell><RequireAuth><RequireOnboarding><ObservabilityPage /></RequireOnboarding></RequireAuth></Shell>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
