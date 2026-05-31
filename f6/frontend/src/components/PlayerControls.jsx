import { useState, useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

const PlayerControls = ({ audioBlob, audioUrl }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const waveformRef = useRef(null)
  const wavesurferRef = useRef(null)

  useEffect(() => {
    wavesurferRef.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#10b981',
      progressColor: '#34d399',
      cursorColor: '#10b981',
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      height: 100,
      normalize: true,
    })

    wavesurferRef.current.on('play', () => setIsPlaying(true))
    wavesurferRef.current.on('pause', () => setIsPlaying(false))
    wavesurferRef.current.on('timeupdate', (currentTime) => {
      setCurrentTime(currentTime)
    })
    wavesurferRef.current.on('ready', () => {
      setDuration(wavesurferRef.current.getDuration())
    })

    wavesurferRef.current.setVolume(volume)

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy()
      }
    }
  }, [])

  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob)
      wavesurferRef.current.load(url)
    } else if (audioUrl) {
      wavesurferRef.current.load(audioUrl)
    }
  }, [audioBlob, audioUrl])

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume)
    }
  }, [volume])

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause()
    }
  }

  const stopPlayback = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.stop()
      setIsPlaying(false)
    }
  }

  const skipBackward = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.skip(-2)
    }
  }

  const skipForward = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.skip(2)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!audioBlob && !audioUrl) {
    return (
      <div className="player-container">
        <h2>播放控制</h2>
        <div className="no-audio-message">
          请先录音或上传音频
        </div>
      </div>
    )
  }

  return (
    <div className="player-container">
      <h2>播放控制</h2>
      <div className="waveform-container" ref={waveformRef}></div>
      <div className="time-display">
        <span>{formatTime(currentTime)}</span>
        <span>/</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="player-controls">
        <button className="control-btn" onClick={skipBackward}>
          ⏮ -2秒
        </button>
        <button className="control-btn play-btn" onClick={togglePlay}>
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button className="control-btn" onClick={stopPlayback}>
          ⏹ 停止
        </button>
        <button className="control-btn" onClick={skipForward}>
          +2秒 ⏭
        </button>
      </div>
      <div className="volume-control">
        <span className="volume-label">音量:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="volume-slider"
        />
        <span className="volume-value">{Math.round(volume * 100)}%</span>
      </div>
    </div>
  )
}

export default PlayerControls
