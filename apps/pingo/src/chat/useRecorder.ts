import { useCallback, useEffect, useRef, useState } from 'react'

export interface Recording {
  blob: Blob
  durationMs: number
}

/** Gravação de áudio pelo microfone, com analisador para a onda ao vivo. */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const cleanup = useCallback(() => {
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    void ctx.current?.close()
    stream.current = null
    ctx.current = null
    recorder.current = null
    setAnalyser(null)
    setRecording(false)
    setElapsedMs(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  /** Devolve false se o microfone foi negado ou não existe. */
  const start = useCallback(async (): Promise<boolean> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      const ac = new AudioContext()
      ctx.current = ac
      const node = ac.createAnalyser()
      node.fftSize = 256
      ac.createMediaStreamSource(s).connect(node)
      setAnalyser(node)

      const mr = new MediaRecorder(s)
      chunks.current = []
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      mr.start(250)
      recorder.current = mr
      startedAt.current = Date.now()
      setRecording(true)
      timer.current = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 200)
      return true
    } catch {
      cleanup()
      return false
    }
  }, [cleanup])

  const stop = useCallback((): Promise<Recording | null> => {
    const mr = recorder.current
    if (!mr) return Promise.resolve(null)
    const durationMs = Date.now() - startedAt.current
    return new Promise((resolve) => {
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/mp4' })
        cleanup()
        resolve(durationMs < 600 ? null : { blob, durationMs })
      }
      mr.stop()
    })
  }, [cleanup])

  const cancel = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.onstop = null
      recorder.current.stop()
    }
    cleanup()
  }, [cleanup])

  return { recording, elapsedMs, analyser, start, stop, cancel }
}
