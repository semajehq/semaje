import { Upload, Mic } from 'lucide-react'

export default function TabSwitcher({ activeTab, onChange }) {
  const btn = (tab, icon, label, shortLabel) => {
    const active = activeTab === tab
    return (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all flex-1 justify-center whitespace-nowrap"
        style={{
          background: active ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
          color: active ? 'var(--accent)' : 'var(--muted)',
          border: active ? '1px solid rgba(var(--accent-rgb),0.25)' : '1px solid transparent',
        }}
      >
        {icon}
        <span className="full-tab-label">{label}</span>
        <span className="short-tab-label hidden">{shortLabel}</span>
      </button>
    )
  }

  return (
    <div
      className="flex gap-1 p-1 rounded-lg border sm:min-w-[19rem]"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {btn('upload', <Upload size={13} />, 'Upload File', 'Upload')}
      {btn('live', <Mic size={13} />, 'Live Recording', 'Live')}
    </div>
  )
}
