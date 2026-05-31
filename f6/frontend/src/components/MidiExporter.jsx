import { useState } from 'react'
import { MidiFile } from 'jsmidgen'
import { downloadMidiFromBackend } from '../services/api'

const MidiExporter = ({ midiData, bpm, audioId }) => {
  const [isExporting, setIsExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState(null)

  const noteNameToMidiNumber = (noteName) => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const octave = parseInt(noteName.slice(-1))
    const note = noteName.slice(0, -1)
    const semitone = notes.indexOf(note)
    return (octave + 1) * 12 + semitone
  }

  const ticksToSeconds = (ticks, bpm, ticksPerBeat = 128) => {
    return (ticks / ticksPerBeat) * (60 / bpm)
  }

  const secondsToTicks = (seconds, bpm, ticksPerBeat = 128) => {
    return Math.round(seconds * (bpm / 60) * ticksPerBeat)
  }

  const exportToMidi = () => {
    if (!midiData || !midiData.tracks) {
      setExportStatus({ success: false, message: '没有可导出的 MIDI 数据' })
      return
    }

    setIsExporting(true)
    setExportStatus(null)

    try {
      const midi = new MidiFile()
      const currentBpm = bpm || 120

      midiData.tracks.forEach((track, trackIndex) => {
        const trackName = track.name || `Track ${trackIndex + 1}`
        
        midi.addTrack()
        const trackIdx = trackIndex

        midi.setTempo(trackIdx, 0, currentBpm)

        midi.addTrackName(trackIdx, 0, trackName)

        if (track.notes) {
          track.notes.forEach((note) => {
            const midiNumber = noteNameToMidiNumber(note.name)
            const velocity = Math.round((note.velocity || 0.8) * 127)
            const startTick = secondsToTicks(note.time, currentBpm)
            const durationTicks = secondsToTicks(note.duration, currentBpm)

            midi.addNoteOn(trackIdx, startTick, 0, midiNumber, velocity)
            midi.addNoteOff(trackIdx, startTick + durationTicks, 0, midiNumber, 0)
          })
        }
      })

      const midiBytes = midi.toBytes()
      const uint8Array = new Uint8Array(midiBytes)
      const blob = new Blob([uint8Array], { type: 'audio/midi' })
      const url = URL.createObjectURL(blob)
      
      const link = document.createElement('a')
      link.href = url
      link.download = `export_${Date.now()}.mid`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setExportStatus({ success: true, message: 'MIDI 文件导出成功！' })
    } catch (error) {
      console.error('MIDI 导出错误:', error)
      setExportStatus({ success: false, message: `导出失败: ${error.message}` })
    } finally {
      setIsExporting(false)
    }
  }

  const downloadFromBackend = async () => {
    if (!audioId) {
      setExportStatus({ success: false, message: '没有可用的音频 ID' })
      return
    }

    setIsExporting(true)
    setExportStatus(null)

    try {
      const blob = await downloadMidiFromBackend(audioId)
      const url = URL.createObjectURL(blob)
      
      const link = document.createElement('a')
      link.href = url
      link.download = `backend_${audioId}_${Date.now()}.mid`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setExportStatus({ success: true, message: '从后端下载 MIDI 成功！' })
    } catch (error) {
      console.error('后端 MIDI 下载错误:', error)
      setExportStatus({ success: false, message: `下载失败: ${error.message}` })
    } finally {
      setIsExporting(false)
    }
  }

  const noteCount = midiData?.tracks?.reduce((acc, t) => acc + (t.notes?.length || 0), 0) || 0

  return (
    <div className="midi-exporter-container">
      <h2>MIDI 导出器</h2>

      <div className="export-info">
        <div className="export-stats">
          <span className="stat-item">
            <strong>音轨数:</strong> {midiData?.tracks?.length || 0}
          </span>
          <span className="stat-item">
            <strong>音符数:</strong> {noteCount}
          </span>
          <span className="stat-item">
            <strong>BPM:</strong> {bpm || 120}
          </span>
        </div>
      </div>

      <div className="export-controls">
        <button
          className="export-btn local-btn"
          onClick={exportToMidi}
          disabled={isExporting || noteCount === 0}
        >
          {isExporting ? '导出中...' : '📥 本地导出 MIDI'}
        </button>

        {audioId && (
          <button
            className="export-btn backend-btn"
            onClick={downloadFromBackend}
            disabled={isExporting}
          >
            {isExporting ? '下载中...' : '🌐 从后端下载 MIDI'}
          </button>
        )}
      </div>

      {exportStatus && (
        <div className={`export-status ${exportStatus.success ? 'success' : 'error'}`}>
          {exportStatus.message}
        </div>
      )}

      <div className="export-hint">
        <p>
          💡 <strong>提示:</strong> 本地导出使用 jsmidgen 库直接在浏览器中生成标准 MIDI
          文件。后端下载需要先上传音频并在服务器端处理。
        </p>
      </div>
    </div>
  )
}

export default MidiExporter
