import { Cpu, ShieldCheck, Workflow } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="w-full py-8 text-center text-xs font-mono flex flex-wrap items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
      <Cpu size={12} />
      Open-source STT + TTS · 1,600+ languages
      <span style={{ color: 'var(--border)' }}>·</span>
      <Workflow size={12} />
      Swappable LLM tasks
      <span style={{ color: 'var(--border)' }}>·</span>
      <ShieldCheck size={12} />
      Audio processed securely
    </footer>
  )
}
