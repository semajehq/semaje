import { useState, useRef } from 'react'
import { Disc3, Upload, FileAudio } from 'lucide-react'

export default function DropZone({ onFile, disabled, active = false }) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const inputRef = useRef()

  const handleFile = (file) => {
    if (!file) return
    setFileName(file.name)
    onFile(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`capture-drop select-none ${dragging ? 'drag-active' : ''} ${active ? 'is-processing' : ''} ${disabled ? 'is-disabled' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
      <div className="capture-reel" aria-hidden="true">
        <span /><span />
        <div className="capture-tape" />
      </div>
      <div className="flex justify-center mb-4">
        {fileName ? (
          <div className="capture-drop-icon">
            <FileAudio size={24} style={{ color: 'var(--accent)' }} />
          </div>
        ) : (
          <div className="capture-drop-icon">
            <Disc3 size={24} style={{ color: 'var(--muted)' }} />
          </div>
        )}
      </div>
      <p className="font-semibold text-base mb-1">
        {fileName || 'Drop a recording into the workspace'}
      </p>
      <p className="text-xs font-mono mb-3" style={{ color: 'var(--muted)' }}>
        MP3 / WAV / M4A / OGG / FLAC / MP4
      </p>
      {!fileName && (
        <div className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-lg border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          <Upload size={12} /> or click to browse
        </div>
      )}
    </div>
  )
}
