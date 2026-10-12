import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { FileText, Copy, Check, Download, Loader2, AlertTriangle } from 'lucide-react'

export default function TranscriptOutput({ transcript, status, error, loading }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcript-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-display font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--accent)' }}>
          <FileText size={13} />
          Transcript
        </span>
        {transcript && (
          <div className="flex gap-2">
            <button onClick={handleCopy}
              className="text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5"
              style={{ borderColor: 'var(--border)', color: copied ? '#4ade80' : 'var(--muted)' }}>
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
            <button onClick={handleDownload}
              className="text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              <Download size={12} /> .txt
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 min-h-[120px]">
        {loading && (
          <div className="flex items-center gap-3 text-xs font-mono" style={{ color: 'var(--muted)' }}>
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
            {status}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-xs font-mono" style={{ color: '#f87171' }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {transcript && (
          <div className="prose-output text-sm leading-relaxed font-sans" style={{ color: 'var(--text)' }}>
            <ReactMarkdown
              components={{
                h1: ({ children }) => <h1 className="text-xl font-display font-bold mt-4 mb-2" style={{ color: 'var(--accent)' }}>{children}</h1>,
                h2: ({ children }) => <h2 className="text-lg font-display font-bold mt-4 mb-2" style={{ color: 'var(--accent)' }}>{children}</h2>,
                h3: ({ children }) => <h3 className="text-base font-display font-semibold mt-3 mb-1.5" style={{ color: 'var(--accent)' }}>{children}</h3>,
                h4: ({ children }) => <h4 className="text-sm font-display font-semibold mt-2 mb-1" style={{ color: 'var(--text)' }}>{children}</h4>,
                p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 pl-5 list-disc space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 pl-5 list-decimal space-y-1">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                strong: ({ children }) => <strong className="font-bold" style={{ color: 'var(--text)' }}>{children}</strong>,
                em: ({ children }) => <em className="italic" style={{ color: 'var(--muted)' }}>{children}</em>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 pl-4 my-3 italic" style={{ borderColor: 'var(--accent)', color: 'var(--muted)' }}>
                    {children}
                  </blockquote>
                ),
                code: ({ inline, children }) =>
                  inline
                    ? <code className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg)', color: 'var(--accent)' }}>{children}</code>
                    : <pre className="p-3 rounded-lg my-3 overflow-x-auto text-xs font-mono" style={{ background: 'var(--bg)' }}><code>{children}</code></pre>,
                hr: () => <hr className="my-4 border-t" style={{ borderColor: 'var(--border)' }} />,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-3">
                    <table className="w-full text-xs border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead style={{ borderBottom: '1px solid var(--border)' }}>{children}</thead>,
                th: ({ children }) => <th className="text-left px-3 py-2 font-display font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{children}</th>,
                td: ({ children }) => <td className="px-3 py-2 border-t text-xs" style={{ borderColor: 'var(--border)' }}>{children}</td>,
              }}
            >
              {transcript}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
