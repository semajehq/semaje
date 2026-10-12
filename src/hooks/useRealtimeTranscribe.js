// Realtime transcription over the platform WebSocket (services/realtime).
// One persistent socket; the server windows audio to the STT service.
import { useState, useRef, useCallback } from 'react'
import { getAccessToken } from '../utils/apiClient'

const CHUNK_MS = 1000 // MediaRecorder timeslice; server windows every ~5s

function detectMimeType() {
  const types = [
    'audio/webm;codecs=opus', 'audio/webm',
    'audio/ogg;codecs=opus', 'audio/mp4;codecs=aac', 'audio/mp4',
  ]
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm'
}

export function useRealtimeTranscribe() {
  const [isRecording, setIsRecording] = useState(false)
  const [segments, setSegments] = useState([])
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState(null)

  const wsRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)

  const start = useCallback(async ({ mode = 'dictation', title = '', language = '' } = {}) => {
    setError('')
    setSavedId(null)
    if (!window.MediaRecorder) {
      setError('Your browser does not support live recording.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = detectMimeType()

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const token = getAccessToken()
      const ws = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${token}` : ''}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', mode, title, mimeType, ...(language ? { language } : {}) }))
        const recorder = new MediaRecorder(stream, { mimeType })
        recorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data?.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then(buf => ws.send(buf))
          }
        }
        recorder.start(CHUNK_MS)
        setIsRecording(true)
      }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return
        const msg = JSON.parse(e.data)
        if (msg.type === 'final') {
          setSegments(prev => [...prev, {
            id: `${msg.tStart}-${msg.tEnd}`,
            text: msg.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            status: 'done',
          }])
        } else if (msg.type === 'error') {
          console.warn('[realtime]', msg.error)
        } else if (msg.type === 'end') {
          if (msg.transcriptId) setSavedId(msg.transcriptId)
          ws.close()
        }
      }
      ws.onerror = () => setError('Connection to the transcription server failed.')
    } catch (err) {
      setError(err.message || 'Microphone access denied.')
    }
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Give the last ondataavailable a beat to flush before stop
      setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 150)
    }
    setIsRecording(false)
  }, [])

  const clear = useCallback(() => { setSegments([]); setError(''); setSavedId(null) }, [])

  return { isRecording, segments, error, savedId, start, stop, clear }
}
