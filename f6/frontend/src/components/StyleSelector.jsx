import { useState, useEffect } from 'react'
import { MUSIC_STYLES, stylizeChord, generateRhythmPattern } from '../utils/musicStyles'
import * as Tone from 'tone'

const StyleSelector = ({
  selectedStyle,
  onStyleChange,
  currentChords,
  onStyleApplied,
  isPlaying,
  onPlayStateChange,
  currentBpm,
}) => {
  const [localStyle, setLocalStyle] = useState(selectedStyle || 'jazz')
  const [stylizedChords, setStylizedChords] = useState([])
  const [rhythmPattern, setRhythmPattern] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [previewProgress, setPreviewProgress] = useState(0)
  const synthRef = useState(null)

  useEffect(() => {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.02,
          decay: 0.1,
          sustain: 0.3,
          release: 0.8,
        },
      }).toDestination()
    }
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose()
      }
    }
  }, [])

  const applyStyle = async () => {
    if (currentChords && currentChords.length > 0) {
      setIsLoading(true)
      try {
        const stylized = currentChords.map((chordInfo, index) => {
          const chordName = chordInfo.chord || chordInfo.root || 'C'
          const stylized = stylizeChord(chordName, localStyle, 4)
          stylized.bar = index + 1
          return stylized
        })
        setStylizedChords(stylized)

        const pattern = generateRhythmPattern(localStyle, currentChords.length)
        setRhythmPattern(pattern)

        if (onStyleApplied) {
          onStyleApplied({
            style: localStyle,
            stylizedChords: stylized,
            rhythmPattern: pattern,
            styleConfig: MUSIC_STYLES[localStyle],
          })
        }
      } catch (error) {
        console.error('Error applying style:', error)
      } finally {
        setIsLoading(false)
      }
    }
  }

  const playStylePreview = async () => {
    if (stylizedChords.length === 0) return

    await Tone.start()
    const synth = synthRef.current
    const now = Tone.now()
    const beatDuration = 60 / currentBpm

    setPreviewProgress(0)
    onPlayStateChange(true)

    stylizedChords.forEach((chord, index) => {
      const time = now + index * beatDuration
      const notes = chord.notes.map((midi) => Tone.Frequency(midi, 'midi').toNote())

      if (notes.length > 0) {
        synth.triggerAttackRelease(notes, beatDuration * 0.8, time)
      }
    })

    const totalDuration = stylizedChords.length * beatDuration * 1000
    const progressInterval = setInterval(() => {
      setPreviewProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval)
          onPlayStateChange(false)
          return 100
        }
        return prev + 5
      })
    }, totalDuration / 20)
  }

  const stopPreview = () => {
    if (synthRef.current) {
      synthRef.current.releaseAll()
    }
    setPreviewProgress(0)
    onPlayStateChange(false)
  }

  const styleIcons = {
    jazz: '🎷',
    electronic: '🎹',
    classical: '🎻',
    rock: '🎸',
    latin: '💃',
  }

  const styleColors = {
    jazz: '#8B5CF6',
    electronic: '#06B6D4',
    classical: '#10B981',
    rock: '#EF4444',
    latin: '#F59E0B',
  }

  return (
    <div className="style-selector-container">
      <h2 className="section-title">🎨 音乐风格</h2>

      <div className="style-grid">
        {Object.entries(MUSIC_STYLES).map(([key, style]) => (
          <button
            key={key}
            className={`style-card ${localStyle === key ? 'selected' : ''}`}
            onClick={() => {
              setLocalStyle(key)
              if (onStyleChange) {
                onStyleChange(key)
              }
            }}
            style={{
              borderColor: localStyle === key ? styleColors[key] : 'transparent',
            }}
          >
            <span className="style-icon">{styleIcons[key]}</span>
            <span className="style-name">{style.name}</span>
            <span className="style-description">{style.description}</span>
          </button>
        ))}
      </div>

      {currentChords && currentChords.length > 0 && (
        <div className="style-controls">
          <button
            className="apply-style-btn"
            onClick={applyStyle}
            disabled={isLoading}
            style={{ backgroundColor: styleColors[localStyle] }}
          >
            {isLoading ? '处理中...' : `应用 ${MUSIC_STYLES[localStyle].name} 风格`}
          </button>

          {stylizedChords.length > 0 && (
            <div className="preview-controls">
              <button
                className={`preview-btn ${isPlaying ? 'playing' : ''}`}
                onClick={isPlaying ? stopPreview : playStylePreview}
              >
                {isPlaying ? '⏸ 停止预览' : '▶ 预览效果'}
              </button>

              {previewProgress > 0 && (
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${previewProgress}%`,
                      backgroundColor: styleColors[localStyle],
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {stylizedChords.length > 0 && (
        <div className="stylized-chords-preview">
          <h3>风格化和弦</h3>
          <div className="chords-list">
            {stylizedChords.map((chord, index) => (
              <div
                key={index}
                className="chord-item"
                style={{ borderLeftColor: styleColors[localStyle] }}
              >
                <span className="chord-bar">小节 {chord.bar}</span>
                <span className="chord-name">
                  {chord.root}
                  {chord.type !== 'maj' ? chord.type : ''}
                </span>
                <span className="chord-quality">{chord.quality}</span>
                <span className="chord-inversion">转位: {chord.inversion}</span>
              </div>
            ))}
          </div>

          {rhythmPattern && (
            <div className="rhythm-info">
              <h4>节奏模式: {rhythmPattern.patternName}</h4>
              <p>摇摆率: {(rhythmPattern.swingRatio * 100).toFixed(0)}%</p>
              <p>拍点数: {rhythmPattern.pattern.length}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StyleSelector
