import { useState, useEffect, useRef, useCallback } from 'react'
import { medianFilter, removeOutliers, calculateWeightedAverage } from '../utils/bpmUtils'

const BpmDetector = ({ onBpmDetected, isDetecting, onDetectingChange }) => {
  const [tapTimes, setTapTimes] = useState([])
  const [currentBpm, setCurrentBpm] = useState(0)
  const [averageBpm, setAverageBpm] = useState(0)
  const [filteredBpm, setFilteredBpm] = useState(0)
  const [tapCount, setTapCount] = useState(0)
  const lastTapRef = useRef(null)
  const timeoutRef = useRef(null)
  const bpmHistoryRef = useRef([])

  const calculateBpm = useCallback((intervals) => {
    if (intervals.length < 2) return 0

    let processedIntervals = [...intervals]
    if (processedIntervals.length >= 6) {
      processedIntervals = removeOutliers(processedIntervals, 1.5)
    }
    if (processedIntervals.length >= 5) {
      processedIntervals = medianFilter(processedIntervals, 5)
    }

    const recentIntervals = processedIntervals.slice(-12)
    const weightedInterval = calculateWeightedAverage(recentIntervals)
    const bpm = Math.round(60000 / weightedInterval)

    return Math.max(40, Math.min(300, bpm))
  }, [])

  const getStableBpm = useCallback((newBpm) => {
    bpmHistoryRef.current.push(newBpm)
    if (bpmHistoryRef.current.length > 15) {
      bpmHistoryRef.current.shift()
    }

    if (bpmHistoryRef.current.length < 5) return newBpm

    const filtered = medianFilter(bpmHistoryRef.current, 7)
    const noOutliers = removeOutliers(filtered, 2.0)
    const stable = Math.round(calculateWeightedAverage(noOutliers))

    return Math.max(40, Math.min(300, stable))
  }, [])

  const handleTap = useCallback(() => {
    const now = Date.now()

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    if (lastTapRef.current) {
      const interval = now - lastTapRef.current

      if (interval < 5000) {
        setTapTimes((prev) => {
          const newTimes = [...prev, interval]
          const rawBpm = Math.round(60000 / interval)
          setCurrentBpm(rawBpm)

          const avg = calculateBpm(newTimes)
          setAverageBpm(avg)

          if (newTimes.length >= 3) {
            const stable = getStableBpm(avg)
            setFilteredBpm(stable)
            if (onBpmDetected) {
              onBpmDetected(stable)
            }
          }

          return newTimes
        })
        setTapCount((prev) => prev + 1)
      } else {
        setTapTimes([interval])
        setTapCount(1)
        setCurrentBpm(0)
        setAverageBpm(0)
        setFilteredBpm(0)
        bpmHistoryRef.current = []
      }
    } else {
      setTapCount(1)
      if (onDetectingChange) {
        onDetectingChange(true)
      }
    }

    lastTapRef.current = now

    timeoutRef.current = setTimeout(() => {
      lastTapRef.current = null
      if (onDetectingChange) {
        onDetectingChange(false)
      }
    }, 3000)
  }, [calculateBpm, getStableBpm, onBpmDetected, onDetectingChange])

  const resetTaps = () => {
    setTapTimes([])
    setCurrentBpm(0)
    setAverageBpm(0)
    setFilteredBpm(0)
    setTapCount(0)
    lastTapRef.current = null
    bpmHistoryRef.current = []
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    if (onDetectingChange) {
      onDetectingChange(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTap])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const getBpmColor = (bpm) => {
    if (bpm < 60) return '#10b981'
    if (bpm < 100) return '#3b82f6'
    if (bpm < 140) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <div className="bpm-detector-container">
      <h2>BPM 检测</h2>

      <div className="tap-display">
        <button
          className={`tap-button ${isDetecting ? 'detecting' : ''}`}
          onClick={handleTap}
        >
          {tapCount === 0 ? '点击或按空格键' : `点击 ${tapCount}`}
        </button>
      </div>

      <div className="bpm-display">
        <div className="bpm-item">
          <span className="bpm-label">原始 BPM</span>
          <span
            className="bpm-value"
            style={{ color: getBpmColor(currentBpm) }}
          >
            {currentBpm || '--'}
          </span>
        </div>
        <div className="bpm-item">
          <span className="bpm-label">平均 BPM</span>
          <span
            className="bpm-value"
            style={{ color: getBpmColor(averageBpm) }}
          >
            {averageBpm || '--'}
          </span>
        </div>
        <div className="bpm-item">
          <span className="bpm-label stable">稳定 BPM</span>
          <span
            className="bpm-value large stable"
            style={{ color: getBpmColor(filteredBpm) }}
          >
            {filteredBpm || '--'}
          </span>
        </div>
      </div>

      {tapTimes.length > 0 && (
        <div className="tap-history">
          <span className="history-label">最近间隔:</span>
          <div className="interval-list">
            {tapTimes.slice(-5).map((interval, index) => (
              <span key={index} className="interval-item">
                {interval}ms
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="detector-controls">
        <button className="reset-btn" onClick={resetTaps}>
          重置
        </button>
        {filteredBpm > 0 && (
          <button
            className="apply-btn"
            onClick={() => onBpmDetected && onBpmDetected(filteredBpm)}
          >
            应用稳定 BPM
          </button>
        )}
      </div>

      <div className="hint-text">
        提示：跟随音乐节奏点击按钮或按空格键，点击3次以上开始计算
      </div>
    </div>
  )
}

export default BpmDetector
