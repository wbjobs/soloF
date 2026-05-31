import { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import wsManager from '../services/websocket'
import { BpmSmoother, KalmanFilter } from '../utils/bpmUtils'

const AccompanimentFollower = ({
  isFollowing,
  onFollowingChange,
  targetBpm,
  onBpmUpdate,
  midiData,
  onWsConnectionChange,
}) => {
  const [currentBpm, setCurrentBpm] = useState(120)
  const [rawBpm, setRawBpm] = useState(120)
  const [targetBpmState, setTargetBpmState] = useState(targetBpm || 120)
  const [smoothingFactor, setSmoothingFactor] = useState(0.25)
  const [smoothingLevel, setSmoothingLevel] = useState('medium')
  const [confidence, setConfidence] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [wsUrl, setWsUrl] = useState('ws://localhost:8000/ws/midi')
  const [receivedNotes, setReceivedNotes] = useState([])
  const synthRef = useRef(null)
  const bpmSmootherRef = useRef(null)
  const kalmanFilterRef = useRef(null)

  useEffect(() => {
    bpmSmootherRef.current = new BpmSmoother({
      historySize: 20,
      smoothingFactor: smoothingFactor,
    })
    kalmanFilterRef.current = new KalmanFilter(0.0005, 0.05, 0.5)
  }, [])

  useEffect(() => {
    if (bpmSmootherRef.current) {
      bpmSmootherRef.current.smoothingFactor = smoothingFactor
    }
  }, [smoothingFactor])

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.1,
        release: 0.3,
      },
    }).toDestination()

    synthRef.current.volume.value = -10

    return () => {
      if (synthRef.current) {
        synthRef.current.dispose()
      }
    }
  }, [])

  useEffect(() => {
    setTargetBpmState(targetBpm || 120)
  }, [targetBpm])

  useEffect(() => {
    const handleOpen = () => {
      setIsConnected(true)
      if (onWsConnectionChange) {
        onWsConnectionChange(true)
      }
    }

    const handleClose = () => {
      setIsConnected(false)
      if (onWsConnectionChange) {
        onWsConnectionChange(false)
      }
    }

    const handleMidi = (payload) => {
      if (payload.type === 'note_on') {
        setReceivedNotes((prev) => {
          const newNotes = [...prev, { ...payload, id: Date.now() }]
          return newNotes.slice(-10)
        })

        if (isFollowing) {
          synthRef.current.triggerAttackRelease(
            payload.note,
            '8n',
            Tone.now(),
            payload.velocity / 127
          )
        }
      }
    }

    const handleBpmUpdate = (payload) => {
      if (isFollowing && payload.bpm) {
        updateBpmSmooth(payload.bpm)
      }
    }

    wsManager.on('open', handleOpen)
    wsManager.on('close', handleClose)
    wsManager.on('midi', handleMidi)
    wsManager.on('bpm', handleBpmUpdate)

    return () => {
      wsManager.off('open', handleOpen)
      wsManager.off('close', handleClose)
      wsManager.off('midi', handleMidi)
      wsManager.off('bpm', handleBpmUpdate)
    }
  }, [isFollowing])

  const updateBpmSmooth = useCallback(
    (newBpm) => {
      setRawBpm(newBpm)

      if (!bpmSmootherRef.current) {
        bpmSmootherRef.current = new BpmSmoother({
          historySize: 20,
          smoothingFactor: smoothingFactor,
        })
      }

      const smoothedBpm = bpmSmootherRef.current.process(newBpm)
      const confidenceValue = bpmSmootherRef.current.getConfidence()
      setConfidence(confidenceValue)

      setCurrentBpm((prev) => {
        Tone.Transport.bpm.value = smoothedBpm

        if (onBpmUpdate) {
          onBpmUpdate(smoothedBpm)
        }

        return smoothedBpm
      })
    },
    [smoothingFactor, onBpmUpdate]
  )

  const handleSmoothingLevelChange = (level) => {
    setSmoothingLevel(level)
    const factorMap = {
      low: 0.5,
      medium: 0.25,
      high: 0.1,
    }
    setSmoothingFactor(factorMap[level] || 0.25)
  }

  const resetSmoothing = () => {
    if (bpmSmootherRef.current) {
      bpmSmootherRef.current.reset()
    }
    if (kalmanFilterRef.current) {
      kalmanFilterRef.current.reset()
    }
    setConfidence(0)
  }

  const connectWebSocket = () => {
    wsManager.connect(wsUrl)
  }

  const disconnectWebSocket = () => {
    wsManager.disconnect()
    setIsConnected(false)
    if (onWsConnectionChange) {
      onWsConnectionChange(false)
    }
  }

  const toggleFollowing = () => {
    const newState = !isFollowing
    if (onFollowingChange) {
      onFollowingChange(newState)
    }
  }

  const noteNameToFreq = (noteName) => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const octave = parseInt(noteName.slice(-1))
    const note = noteName.slice(0, -1)
    const semitone = notes.indexOf(note)
    const a4 = 440
    return a4 * Math.pow(2, (octave - 4) * 12 + semitone - 9)
  }

  return (
    <div className="accompaniment-follower-container">
      <h2>实时伴奏跟随</h2>

      <div className="ws-connection-section">
        <div className="ws-input-group">
          <label>WebSocket 地址:</label>
          <input
            type="text"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            disabled={isConnected}
            className="ws-url-input"
          />
        </div>
        <div className="ws-controls">
          {isConnected ? (
            <button className="disconnect-btn" onClick={disconnectWebSocket}>
              断开连接
            </button>
          ) : (
            <button className="connect-btn" onClick={connectWebSocket}>
              连接
            </button>
          )}
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
        </div>
      </div>

      <div className="following-control">
        <button
          className={`follow-toggle-btn ${isFollowing ? 'following' : ''}`}
          onClick={toggleFollowing}
          disabled={!isConnected}
        >
          {isFollowing ? '⏸ 停止跟随' : '▶ 开始跟随'}
        </button>
      </div>

      <div className="bpm-following-display">
        <div className="bpm-follow-item">
          <span className="bpm-follow-label">原始输入 BPM</span>
          <span className="bpm-follow-value raw">{rawBpm}</span>
        </div>
        <div className="bpm-follow-item">
          <span className="bpm-follow-label">当前播放 BPM</span>
          <span className="bpm-follow-value current">{currentBpm}</span>
        </div>
        <div className="bpm-follow-item">
          <span className="bpm-follow-label">目标 BPM</span>
          <span className="bpm-follow-value target">{targetBpmState}</span>
        </div>
        <div className="bpm-follow-item">
          <span className="bpm-follow-label">平滑置信度</span>
          <span className={`bpm-follow-value confidence ${confidence > 0.7 ? 'high' : ''}`}>
            {Math.round(confidence * 100)}%
          </span>
        </div>
      </div>

      <div className="smoothing-control-section">
        <div className="smoothing-level-buttons">
          <span className="level-label">平滑级别:</span>
          {['low', 'medium', 'high'].map((level) => (
            <button
              key={level}
              className={`level-btn ${smoothingLevel === level ? 'active' : ''}`}
              onClick={() => handleSmoothingLevelChange(level)}
            >
              {level === 'low' ? '低' : level === 'medium' ? '中' : '高'}
            </button>
          ))}
          <button className="reset-smoothing-btn" onClick={resetSmoothing}>
            重置
          </button>
        </div>
        <div className="smoothing-slider-container">
          <label className="smoothing-label">
            精细调节: {smoothingFactor.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.05"
            max="0.8"
            step="0.05"
            value={smoothingFactor}
            onChange={(e) => setSmoothingFactor(parseFloat(e.target.value))}
            className="smoothing-slider"
          />
          <div className="smoothing-hint">
            <span>快速响应</span>
            <span>平滑过渡</span>
          </div>
        </div>
      </div>

      {receivedNotes.length > 0 && (
        <div className="received-notes">
          <span className="notes-label">接收到的音符:</span>
          <div className="notes-list">
            {receivedNotes.slice(-5).map((note, index) => (
              <span key={note.id} className="note-item">
                {note.note}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="follower-info">
        <p>
          {isFollowing
            ? '正在跟随实时输入调整伴奏速度...'
            : '连接 WebSocket 并开始跟随以同步伴奏速度'}
        </p>
      </div>
    </div>
  )
}

export default AccompanimentFollower
