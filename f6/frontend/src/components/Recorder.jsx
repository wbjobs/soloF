import { useState, useRef, useEffect } from 'react'
import WaveSurfer from 'wavesurfer.js'

const Recorder = ({ onRecordingComplete }) => {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const waveformRef = useRef(null)
  const wavesurferRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => {
    wavesurferRef.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      cursorColor: '#4f46e5',
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      height: 120,
      normalize: true,
    })

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy()
      }
    }
  }, [])

  useEffect(() => {
    if (audioBlob) {
      const audioUrl = URL.createObjectURL(audioBlob)
      wavesurferRef.current.load(audioUrl)
    }
  }, [audioBlob])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        onRecordingComplete(blob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      setAudioBlob(null)

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 10) {
            stopRecording()
            return 10
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      alert('无法访问麦克风，请检查权限设置')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }

  const handleRecordClick = () => {
    if (isRecording) {
      if (recordingTime >= 5) {
        stopRecording()
      } else {
        alert('录音时长至少需要5秒')
      }
    } else {
      startRecording()
    }
  }

  const resetRecording = () => {
    setAudioBlob(null)
    setRecordingTime(0)
  }

  return (
    <div className="recorder-container">
      <h2>录音</h2>
      <div className="waveform-container" ref={waveformRef}></div>
      <div className="recording-info">
        <span className={`recording-indicator ${isRecording ? 'active' : ''}`}></span>
        <span className="recording-time">{recordingTime}秒</span>
        <span className="recording-hint">(5-10秒)</span>
      </div>
      <div className="recorder-controls">
        <button
          className={`record-btn ${isRecording ? 'recording' : ''}`}
          onClick={handleRecordClick}
        >
          {isRecording ? '停止录音' : '开始录音'}
        </button>
        {audioBlob && (
          <button className="reset-btn" onClick={resetRecording}>
            重新录音
          </button>
        )}
      </div>
    </div>
  )
}

export default Recorder
