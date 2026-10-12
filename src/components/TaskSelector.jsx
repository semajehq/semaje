import { useState } from 'react'
import {
  FileText, Subtitles, Captions, ListChecks, SmilePlus, BookOpen,
  Languages, Globe, Users, Mic, ClipboardList, Stethoscope, Scale,
  Music, Phone, ChevronDown,
} from 'lucide-react'
import { TASK_DEFINITIONS, CATEGORIES } from '../utils/promptBuilder'

const TASK_ICONS = {
  transcription: FileText,
  subtitles:     Subtitles,
  captions:      Captions,
  summary:       ListChecks,
  sentiment:     SmilePlus,
  chapters:      BookOpen,
  translation:   Languages,
  multilingual:  Globe,
  diarization:   Users,
  interview:     Mic,
  meeting:       ClipboardList,
  medical:       Stethoscope,
  legal:         Scale,
  lyrics:        Music,
  voicemail:     Phone,
}

export default function TaskSelector({ task, onTaskChange }) {
  const [open, setOpen] = useState(false)
  const current = TASK_DEFINITIONS[task]
  const CurrentIcon = TASK_ICONS[task] || FileText

  const grouped = {}
  for (const [id, def] of Object.entries(TASK_DEFINITIONS)) {
    const cat = def.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({ id, ...def })
  }

  return (
    <div className="relative">
      {/* Selected task button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full min-w-0 flex items-center gap-3 px-4 py-3 rounded-lg border transition-all"
        style={{
          background: 'var(--surface)',
          borderColor: open ? 'var(--accent)' : 'var(--border)',
          color: 'var(--fg)',
        }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(var(--accent-rgb),0.12)' }}
        >
          <CurrentIcon size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-semibold">{current.label}</div>
          <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>{current.description}</div>
        </div>
        <ChevronDown
          size={16}
          style={{ color: 'var(--muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div
            className="absolute z-50 left-0 right-0 mt-2 rounded-lg border shadow-2xl overflow-hidden"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              maxHeight: '420px',
              overflowY: 'auto',
            }}
          >
            {Object.entries(CATEGORIES).map(([catKey, catLabel]) => {
              const tasks = grouped[catKey]
              if (!tasks) return null
              return (
                <div key={catKey}>
                  <div
                    className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest sticky top-0"
                    style={{ color: 'var(--muted)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                  >
                    {catLabel}
                  </div>
                  {tasks.map(({ id, label, description }) => {
                    const Icon = TASK_ICONS[id] || FileText
                    const isActive = id === task
                    return (
                      <button
                        key={id}
                        onClick={() => { onTaskChange(id); setOpen(false) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left"
                        style={{
                          background: isActive ? 'rgba(var(--accent-rgb),0.08)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--fg)',
                        }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.06)' }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                      >
                        <Icon size={14} style={{ color: isActive ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>{description}</div>
                        </div>
                        {isActive && <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
