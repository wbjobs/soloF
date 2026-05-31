import { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'

const MidiPlayer = ({ midiData, bpm, onBpmChange, onPlayStateChange }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [isLoaded, setIsLoaded] = useState(false)
  const [currentBpm, setCurrentBpm] = useState(bpm || 120)
  const synthRef = useRef(null)
  const partRef = useRef(null)
  const startTimeRef = useRef(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.02,
        decay: 0.1,
        sustain: 0.3,
        release: 0.8,
      },
    }).toDestination()

    synthRef.current.volume.value = Tone.gainToDb(volume)

    return () => {
      if (synthRef.current) {
        synthRef.current.dispose()
      }
      if (partRef.current) {
        partRef.current.dispose()
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.volume.value = Tone.gainToDb(volume)
    }
  }, [volume])

  useEffect(() => {
    setCurrentBpm(bpm || 120)
    if (Tone.Transport) {
      Tone.Transport.bpm.value = bpm || 120
    }
  }, [bpm])

  const parseMidiData = useCallback((data) => {
    const notes = []
    let maxTime = 0

    if (data && data.tracks) {
      data.tracks.forEach((track) => {
        if (track.notes) {
          track.notes.forEach((note) => {
            notes.push({
              time: note.time,
              note: note.name,
              duration: note.duration,
              velocity: note.velocity || 0.8,
            })
            if (note.time + note.duration > maxTime) {
              maxTime = note.time + note.duration
            }
          })
        }
      })
    }

    return { notes, duration: maxTime }
  }, [])

  useEffect(() => {
    if (!midiData) return

    const loadMidi = async () => {
      await Tone.start()

      if (partRef.current) {
        partRef.current.dispose()
      }

      const { notes, duration: dur } = parseMidiData(midiData)
      setDuration(dur)

      partRef.current = new Tone.Part((time, value) => {
        synthRef.current.triggerAttackRelease(
          value.note,
          value.duration,
          time,
          value.velocity
        )
      }, notes)

      partRef.current.start(0)
      setIsLoaded(true)
    }

    loadMidi()
  }, [midiData, parseMidiData])

  const togglePlay = async () => {
    await Tone.start()

    if (isPlaying) {
      Tone.Transport.pause()
      setIsPlaying(false)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    } else {
      Tone.Transport.start()
      startTimeRef.current = Tone.now()
      setIsPlaying(true)

      intervalRef.current = setInterval(() => {
        setCurrentTime(Tone.Transport.seconds)
      }, 100)
    }

    if (onPlayStateChange) {
      onPlayStateChange(!isPlaying)
    }
  }

  const stopPlayback = () => {
    Tone.Transport.stop()
    setIsPlaying(false)
    setCurrentTime(0)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    if (onPlayStateChange) {
      onPlayStateChange(false)
    }
  }

  const handleBpmChange = (newBpm) => {
    const value = Math.max(40, Math.min(300, parseInt(newBpm) || 120))
    setCurrentBpm(value)
    Tone.Transport.bpm.value = value
    if (onBpmChange) {
      onBpmChange(value)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!midiData) {
    return (
      <div className="midi-player-container">
        <h2>MIDI 播放器</h2>
        <div className="no-midi-message">
          请先加载 MIDI 文件
        </div>
      </div>
    )
  }

  return (
    <div className="midi-player-container">
      <h2>MIDI 播放器</h2>

      <div className="midi-info">
        <div className="midi-stats">
          <span className="stat-item">
            <strong>时长:</strong> {formatTime(duration)}
          </span>
          <span className="stat-item">
            <strong>音符数:</strong> {midiData.tracks?.reduce((acc, t) => acc + (t.notes?.length || 0), 0) || 0}
          </span>
        </div>
      </div>

      <div className="bpm-control">
        <label className="bpm-label">BPM:</label>
        <input
          type="range"
          min="40"
          max="300"
          value={currentBpm}
          onChange={(e) => handleBpmChange(e.target.value)}
          className="bpm-slider"
        />
        <input
          type="number"
          min="40"
          max="300"
          value={currentBpm}
          onChange={(e) => handleBpmChange(e.target.value)}
          className="bpm-input"
        />
      </div>

      <div className="time-display">
        <span>{formatTime(currentTime)}</span>
        <span>/</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        ></div>
      </div>

      <div className="player-controls">
        <button className="control-btn" onClick={stopPlayback}>
          ⏹ 停止
        </button>
        <button
          className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={togglePlay}
          disabled={!isLoaded}
        >
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
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

export default MidiPlayer
