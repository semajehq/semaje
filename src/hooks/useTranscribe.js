import { useState, useCallback, useEffect } from 'react'
import { getDefaultOptions } from '../utils/promptBuilder'
import { ingestAudio, pollJob, getTranscript } from '../utils/apiClient'

const LANGUAGE_KEY = 'semaje_language'
const ENGINE_KEY = 'semaje_engine'

function stored(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

export function useTranscribe() {
  const [transcript, setTranscript] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState('transcription')
  const [options, setOptions] = useState(getDefaultOptions('transcription'))
  const [savedId, setSavedId] = useState(null)
  const [jobId, setJobId] = useState(null)
  // '' = auto-detect. Any registry code/alias works: sw, kik_Latn, Yoruba, ...
  const [language, setLanguage] = useState(() => stored(LANGUAGE_KEY, ''))
  const [engine, setEngine] = useState(() => stored(ENGINE_KEY, 'auto'))

  useEffect(() => {
    try {
      if (language) localStorage.setItem(LANGUAGE_KEY, language)
      else localStorage.removeItem(LANGUAGE_KEY)
      localStorage.setItem(ENGINE_KEY, engine)
    } catch { /* storage unavailable (private mode) — keep in memory */ }
  }, [language, engine])

  const changeTask = useCallback((newTask) => {
    setTask(newTask)
    setOptions(getDefaultOptions(newTask))
  }, [])

  const handleFile = async (file) => {
    if (!file) return
    setLoading(true)
    setTranscript('')
    setError('')
    setSavedId(null)
    setJobId(null)

    try {
      setStatus('Uploading recording...')
      const { job } = await ingestAudio(file, {
        task,
        options: { ...options, ...(engine !== 'auto' ? { engine } : {}) },
        language: language || undefined,
        source: 'upload',
        title: file.name.replace(/\.[^.]+$/, ''),
        captureMeta: { client: 'web', lastModified: file.lastModified, size: file.size, type: file.type },
      })
      setJobId(job.id)
      setStatus('Waiting for a worker...')
      const done = await pollJob(job.id, {
        onProgress: j => setStatus(j.status === 'running' ? `Transcribing... ${j.progress}%` : `Job ${j.status}...`),
      })
      if (done.status !== 'succeeded') throw new Error(done.error || `Job ${done.status}`)
      const t = await getTranscript(done.transcript_id)
      setSavedId(t.id)
      setTranscript(t.result ? String(t.result) : t.text)
      setStatus('Done!')
    } catch (err) {
      setError(err.message || 'Transcription failed. Please try again.')
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  return {
    transcript, status, error, loading, task, changeTask, options, setOptions, handleFile, savedId, jobId,
    language, setLanguage, engine, setEngine,
  }
}
