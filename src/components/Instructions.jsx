import { useState } from 'react'
import { Info, ChevronDown, ChevronUp, Upload, Sliders, FileText, Download, Mic, KeyRound } from 'lucide-react'

const steps = [
  {
    icon: Upload,
    title: 'Add source audio',
    description: 'Drop a recording, meeting export, voice memo, or video file into the capture deck, then keep working while semaje prepares the transcript.',
  },
  {
    icon: Sliders,
    title: 'Choose your options',
    description: 'Toggle Speaker Labels to identify different speakers in the audio. Enable Timestamps to add time markers at each paragraph or speaker turn.',
  },
  {
    icon: Mic,
    title: 'Speech pipeline',
    description: 'Open-source speech recognition (Whisper + Omnilingual ASR, 1,600+ languages) runs on your server, then the local task model formats, summarizes, translates, or structures the result.',
  },
  {
    icon: FileText,
    title: 'Review your transcript',
    description: 'The transcript appears below with speaker labels and timestamps (if selected). Use the Copy button or download as a .txt file.',
  },
]

export default function Instructions() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="text-xs font-display font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--muted)' }}>
          <Info size={13} />
          How to use
        </span>
        {open ? <ChevronUp size={14} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--muted)' }} />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {steps.map(({ icon: Icon, title, description }, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid var(--border)' }}>
                  <Icon size={14} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <p className="text-xs font-display font-bold mb-0.5">
                    <span className="font-mono" style={{ color: 'var(--accent)' }}>{i + 1}.</span> {title}
                  </p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t flex items-start gap-2" style={{ borderColor: 'var(--border)' }}>
            <KeyRound size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              <strong>Tip:</strong> In <em>Server mode</em>, model credentials stay on the backend. In <em>Direct mode</em>, your browser uses a local key for task formatting.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
