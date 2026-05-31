import { useState, useEffect, useCallback } from 'react'
import Recorder from './components/Recorder'
import PlayerControls from './components/PlayerControls'
import MidiPlayer from './components/MidiPlayer'
import BpmDetector from './components/BpmDetector'
import AccompanimentFollower from './components/AccompanimentFollower'
import MidiExporter from './components/MidiExporter'
import SpeedFollowSwitch from './components/SpeedFollowSwitch'
import StyleSelector from './components/StyleSelector'
import { healthCheck, uploadAudio } from './services/api'

function App() {
  const [backendStatus, setBackendStatus] = useState('检查中...')
  const [recordedAudio, setRecordedAudio] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [audioList, setAudioList] = useState([])
  const [midiData, setMidiData] = useState(null)
  const [currentBpm, setCurrentBpm] = useState(120)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isFollowing, setIsFollowing] = useState(false)
  const [isWsConnected, setIsWsConnected] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const [currentAudioId, setCurrentAudioId] = useState(null)
  const [selectedStyle, setSelectedStyle] = useState('jazz')
  const [currentChords, setCurrentChords] = useState([])
  const [stylizedResult, setStylizedResult] = useState(null)
  const [isStylePlaying, setIsStylePlaying] = useState(false)

  useEffect(() => {
    checkBackendHealth()
    loadSampleMidi()
    loadSampleChords()
  }, [])

  const checkBackendHealth = async () => {
    try {
      const result = await healthCheck()
      setBackendStatus('在线')
    } catch (err) {
      setBackendStatus('离线')
    }
  }

  const loadSampleMidi = () => {
    const sampleMidi = generateSampleMidi()
    setMidiData(sampleMidi)
  }

  const generateSampleMidi = () => {
    const tracks = []
    const notes = [
      { name: 'C4', time: 0, duration: 0.5 },
      { name: 'D4', time: 0.5, duration: 0.5 },
      { name: 'E4', time: 1, duration: 0.5 },
      { name: 'F4', time: 1.5, duration: 0.5 },
      { name: 'G4', time: 2, duration: 0.5 },
      { name: 'A4', time: 2.5, duration: 0.5 },
      { name: 'B4', time: 3, duration: 0.5 },
      { name: 'C5', time: 3.5, duration: 0.5 },
      { name: 'B4', time: 4, duration: 0.5 },
      { name: 'A4', time: 4.5, duration: 0.5 },
      { name: 'G4', time: 5, duration: 0.5 },
      { name: 'F4', time: 5.5, duration: 0.5 },
      { name: 'E4', time: 6, duration: 0.5 },
      { name: 'D4', time: 6.5, duration: 0.5 },
      { name: 'C4', time: 7, duration: 1 },
    ]

    notes.forEach((note) => {
      for (let i = 0; i < 4; i++) {
        notes.push({
          ...note,
          time: note.time + i * 8,
        })
      }
    })

    tracks.push({
      name: 'Melody',
      notes: notes.slice(0, 60),
    })

    return { tracks }
  }

  const loadSampleChords = () => {
    const sampleChords = [
      { chord: 'C', bar: 1 },
      { chord: 'G', bar: 2 },
      { chord: 'Am', bar: 3 },
      { chord: 'F', bar: 4 },
      { chord: 'C', bar: 5 },
      { chord: 'G', bar: 6 },
      { chord: 'Am', bar: 7 },
      { chord: 'F', bar: 8 },
    ]
    setCurrentChords(sampleChords)
  }

  const handleStyleApplied = useCallback((result) => {
    setStylizedResult(result)
  }, [])

  const handleRecordingComplete = (audioBlob) => {
    setRecordedAudio(audioBlob)
    setUploadStatus(null)
  }

  const handleUploadAudio = async () => {
    if (!recordedAudio) {
      alert('请先录音')
      return
    }

    setIsUploading(true)
    setUploadStatus(null)

    try {
      const result = await uploadAudio(recordedAudio)
      setUploadStatus({
        success: true,
        message: '上传成功',
        data: result,
      })
      setAudioList((prev) => [...prev, result])
      setCurrentAudioId(result.id)
    } catch (error) {
      setUploadStatus({
        success: false,
        message: error.message,
      })
    } finally {
      setIsUploading(false)
    }
  }

  const clearRecording = () => {
    setRecordedAudio(null)
    setUploadStatus(null)
  }

  const handleBpmDetected = useCallback((bpm) => {
    setCurrentBpm(bpm)
  }, [])

  const handleBpmUpdate = useCallback((bpm) => {
    setCurrentBpm(bpm)
  }, [])

  const handleWsConnectionChange = useCallback((connected) => {
    setIsWsConnected(connected)
  }, [])

  const tabs = [
    { id: 'all', label: '全部' },
    { id: 'player', label: 'MIDI 播放' },
    { id: 'detector', label: 'BPM 检测' },
    { id: 'follower', label: '伴奏跟随' },
    { id: 'style', label: '风格迁移' },
    { id: 'exporter', label: 'MIDI 导出' },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 MIDI 音乐工作台</h1>
        <div className={`status-badge ${backendStatus === '在线' ? 'online' : 'offline'}`}>
          后端状态: {backendStatus}
        </div>
      </header>

      <div className="tabs-container">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bpm-display-bar">
        <span className="bpm-label">当前 BPM:</span>
        <span className="bpm-value-large">{currentBpm}</span>
        <div className="speed-follow-switch-wrapper">
          <SpeedFollowSwitch
            isFollowing={isFollowing}
            onFollowingChange={setIsFollowing}
            disabled={!isWsConnected}
          />
        </div>
      </div>

      <main className="app-main">
        {(activeTab === 'all' || activeTab === 'player') && (
          <div className="content-grid">
            <section className="section recorder-section">
              <Recorder onRecordingComplete={handleRecordingComplete} />
            </section>

            <section className="section player-section">
              <PlayerControls audioBlob={recordedAudio} />
            </section>

            <section className="section midi-player-section">
              <MidiPlayer
                midiData={midiData}
                bpm={currentBpm}
                onBpmChange={handleBpmDetected}
              />
            </section>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'detector') && (
          <div className="content-grid single-column">
            <section className="section bpm-detector-section">
              <BpmDetector
                onBpmDetected={handleBpmDetected}
                isDetecting={isDetecting}
                onDetectingChange={setIsDetecting}
              />
            </section>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'follower') && (
          <div className="content-grid single-column">
            <section className="section follower-section">
              <AccompanimentFollower
                isFollowing={isFollowing}
                onFollowingChange={setIsFollowing}
                targetBpm={currentBpm}
                onBpmUpdate={handleBpmUpdate}
                midiData={midiData}
                onWsConnectionChange={handleWsConnectionChange}
              />
            </section>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'style') && (
          <div className="content-grid single-column">
            <section className="section style-selector-section">
              <StyleSelector
                selectedStyle={selectedStyle}
                onStyleChange={setSelectedStyle}
                currentChords={currentChords}
                onStyleApplied={handleStyleApplied}
                isPlaying={isStylePlaying}
                onPlayStateChange={setIsStylePlaying}
                currentBpm={currentBpm}
              />
            </section>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'exporter') && (
          <div className="content-grid single-column">
            <section className="section exporter-section">
              <MidiExporter
                midiData={midiData}
                bpm={currentBpm}
                audioId={currentAudioId}
              />
            </section>
          </div>
        )}

        {activeTab === 'all' && recordedAudio && (
          <section className="section upload-section">
            <h2>上传到服务器</h2>
            <div className="upload-controls">
              <button
                className="upload-btn"
                onClick={handleUploadAudio}
                disabled={isUploading}
              >
                {isUploading ? '上传中...' : '上传音频'}
              </button>
              <button className="clear-btn" onClick={clearRecording}>
                清除录音
              </button>
            </div>
            {uploadStatus && (
              <div className={`upload-status ${uploadStatus.success ? 'success' : 'error'}`}>
                {uploadStatus.message}
              </div>
            )}
          </section>
        )}

        {activeTab === 'all' && audioList.length > 0 && (
          <section className="section audio-list-section">
            <h2>已上传音频 ({audioList.length})</h2>
            <ul className="audio-list">
              {audioList.map((audio, index) => (
                <li key={index} className="audio-item">
                  <span className="audio-name">{audio.filename || `音频 ${index + 1}`}</span>
                  <span className="audio-time">{new Date().toLocaleString('zh-CN')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
