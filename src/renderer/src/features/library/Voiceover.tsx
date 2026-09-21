import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { togglePlayback } from '@/engine/playback/session'
import { useEditor } from '@/store/editor'
import { toast } from '@/store/feedback'
import { addAssetToTimeline, importMedia } from '@/store/projectActions'
import { Button } from '@/ui/Button'

/** Records the microphone while the timeline plays, then drops the take where recording began. */
export function VoiceoverButton() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; startFrame: number } | null>(null)

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(timer)
  }, [recording])

  async function start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 256000
      })
      const chunks: Blob[] = []
      const startFrame = useEditor.getState().playhead
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        try {
          const data = new Uint8Array(await new Blob(chunks).arrayBuffer())
          const path = await window.edion.library.saveRecording(data, useEditor.getState().path)
          const [asset] = await importMedia([path])
          if (asset) addAssetToTimeline(asset, startFrame)
        } catch (error) {
          toast(`Could not save the recording: ${String(error)}`, 'error')
        }
      }
      session.current = { recorder, stream, startFrame }
      recorder.start(1000)
      setSeconds(0)
      setRecording(true)
      if (!useEditor.getState().playing) togglePlayback()
    } catch {
      toast('No microphone available, or access was denied.', 'error')
    }
  }

  function stop(): void {
    session.current?.recorder.stop()
    session.current = null
    setRecording(false)
    if (useEditor.getState().playing) togglePlayback()
  }

  return recording ? (
    <Button onClick={stop} className="border-danger/60 text-danger">
      <Square size={11} fill="currentColor" /> {Math.floor(seconds / 60)}:
      {String(seconds % 60).padStart(2, '0')}
    </Button>
  ) : (
    <Button onClick={() => void start()} title="Record a voiceover from the playhead">
      <Mic size={13} /> Record
    </Button>
  )
}
