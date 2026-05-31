import { useState, useRef, useEffect, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const WARNING_FILE_SIZE = 500 * 1024 * 1024

const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
}

function App() {
  const [videoFiles, setVideoFiles] = useState([])
  const [metadata, setMetadata] = useState({
    title: '',
    author: '',
    copyright: '',
    description: '',
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFFmpegLoaded, setIsFFmpegLoaded] = useState(false)
  const [error, setError] = useState('')
  const [overallProgress, setOverallProgress] = useState(0)
  const ffmpegRef = useRef(new FFmpeg())

  const cleanup = useCallback(() => {
    videoFiles.forEach(file => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
      if (file.downloadUrl) URL.revokeObjectURL(file.downloadUrl)
    })
  }, [videoFiles])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  const loadFFmpeg = async () => {
    const ffmpeg = ffmpegRef.current
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message)
    })

    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      setIsFFmpegLoaded(true)
      setError('')
    } catch (err) {
      console.error('FFmpeg load error:', err)
      setError('FFmpeg 加载失败，请刷新页面重试')
    }
  }

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    const newFiles = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      status: FILE_STATUS.PENDING,
      progress: 0,
      downloadUrl: '',
      error: '',
    }))

    const oversized = newFiles.filter(f => f.size > MAX_FILE_SIZE)
    if (oversized.length > 0) {
      setError(`${oversized.length} 个文件超过 2GB 限制，已跳过`)
      newFiles.splice(newFiles.findIndex(f => f.size > MAX_FILE_SIZE), oversized.length)
    }

    setVideoFiles(prev => [...prev, ...newFiles])
    setOverallProgress(0)

    if (!isFFmpegLoaded) {
      await loadFFmpeg()
    }
  }

  const handleMetadataChange = (field, value) => {
    setMetadata(prev => ({ ...prev, [field]: value }))
  }

  const processSingleFile = async (fileItem) => {
    const ffmpeg = ffmpegRef.current
    const inputName = `input_${fileItem.id}.mp4`
    const outputName = `output_${fileItem.id}.mp4`

    try {
      setVideoFiles(prev => prev.map(f => 
        f.id === fileItem.id 
          ? { ...f, status: FILE_STATUS.PROCESSING, progress: 0 }
          : f
      ))

      await ffmpeg.writeFile(inputName, await fetchFile(fileItem.file))

      const metadataArgs = []
      if (metadata.title) metadataArgs.push('-metadata', `title=${metadata.title}`)
      if (metadata.author) metadataArgs.push('-metadata', `artist=${metadata.author}`)
      if (metadata.copyright) metadataArgs.push('-metadata', `copyright=${metadata.copyright}`)
      if (metadata.description) metadataArgs.push('-metadata', `description=${metadata.description}`)

      const progressHandler = ({ progress: p }) => {
        if (p >= 0) {
          setVideoFiles(prev => prev.map(f => 
            f.id === fileItem.id 
              ? { ...f, progress: Math.round(p * 100) }
              : f
          ))
        }
      }
      ffmpeg.on('progress', progressHandler)

      await ffmpeg.exec([
        '-i', inputName,
        ...metadataArgs,
        '-codec', 'copy',
        '-movflags', '+use_metadata_tags+faststart',
        '-avoid_negative_ts', 'make_zero',
        '-fflags', '+genpts',
        '-max_alloc', '268435456',
        '-bufsize', '10M',
        outputName,
      ])

      const data = await ffmpeg.readFile(outputName)
      const blob = new Blob([data.buffer], { type: 'video/mp4' })
      const downloadUrl = URL.createObjectURL(blob)

      await ffmpeg.deleteFile(inputName)
      await ffmpeg.deleteFile(outputName)

      ffmpeg.off('progress', progressHandler)

      setVideoFiles(prev => prev.map(f => 
        f.id === fileItem.id 
          ? { ...f, status: FILE_STATUS.COMPLETED, progress: 100, downloadUrl }
          : f
      ))

      return true
    } catch (err) {
      console.error('Processing error:', err)
      
      try {
        await ffmpeg.deleteFile(inputName).catch(() => {})
        await ffmpeg.deleteFile(outputName).catch(() => {})
      } catch (e) {}

      setVideoFiles(prev => prev.map(f => 
        f.id === fileItem.id 
          ? { ...f, status: FILE_STATUS.ERROR, error: err.message || '处理失败' }
          : f
      ))
      return false
    }
  }

  const processAllFiles = async () => {
    if (!videoFiles.length || !isFFmpegLoaded || isProcessing) return

    setIsProcessing(true)
    setError('')
    setOverallProgress(0)

    const pendingFiles = videoFiles.filter(f => f.status === FILE_STATUS.PENDING || f.status === FILE_STATUS.ERROR)
    let completed = 0

    for (const file of pendingFiles) {
      await processSingleFile(file)
      completed++
      setOverallProgress(Math.round((completed / pendingFiles.length) * 100))
    }

    setIsProcessing(false)
    setOverallProgress(100)
  }

  const downloadFile = (fileItem) => {
    if (!fileItem.downloadUrl) return
    const a = document.createElement('a')
    a.href = fileItem.downloadUrl
    a.download = `edited_${fileItem.name}`
    a.click()
  }

  const downloadAll = () => {
    const completedFiles = videoFiles.filter(f => f.status === FILE_STATUS.COMPLETED && f.downloadUrl)
    completedFiles.forEach((file, index) => {
      setTimeout(() => downloadFile(file), index * 500)
    })
  }

  const removeFile = (fileId) => {
    setVideoFiles(prev => {
      const file = prev.find(f => f.id === fileId)
      if (file) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
        if (file.downloadUrl) URL.revokeObjectURL(file.downloadUrl)
      }
      return prev.filter(f => f.id !== fileId)
    })
  }

  const clearAll = () => {
    cleanup()
    setVideoFiles([])
    setOverallProgress(0)
    setError('')
  }

  const completedCount = videoFiles.filter(f => f.status === FILE_STATUS.COMPLETED).length
  const hasCompleted = completedCount > 0

  return (
    <div className="app">
      <header className="header">
        <h1>视频元数据编辑器</h1>
        <p className="subtitle">批量编辑视频标题、作者、版权等信息</p>
      </header>

      <main className="main">
        {error && (
          <div className="alert error">
            <span className="alert-icon">⚠️</span>
            {error}
          </div>
        )}

        <div className="upload-section">
          <div className="upload-area">
            <input
              type="file"
              accept="video/*"
              multiple
              onChange={handleFileSelect}
              className="file-input"
              id="file-input"
            />
            <label htmlFor="file-input" className="file-label">
              <div className="upload-icon">📹</div>
              <p>点击选择多个视频文件</p>
              <p className="hint">支持 MP4, MOV, AVI 等格式，单文件最大 2GB</p>
            </label>
          </div>
        </div>

        {videoFiles.length > 0 && (
          <div className="batch-content">
            <div className="queue-section">
              <div className="section-header">
                <h3>处理队列 ({videoFiles.length})</h3>
                <button onClick={clearAll} className="clear-btn">
                  清空全部
                </button>
              </div>

              {isProcessing && (
                <div className="overall-progress">
                  <div className="progress-bar-container">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                  <span className="progress-text">整体进度: {overallProgress}%</span>
                </div>
              )}

              <div className="file-list">
                {videoFiles.map(file => (
                  <div key={file.id} className="file-item">
                    <div className="file-thumb">
                      <video src={file.previewUrl} muted className="thumb-video" />
                    </div>
                    
                    <div className="file-info">
                      <div className="file-name">{file.name}</div>
                      <div className="file-size">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                      
                      {file.status === FILE_STATUS.PROCESSING && (
                        <div className="file-progress">
                          <div className="progress-bar-container small">
                            <div 
                              className="progress-bar-fill processing" 
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                          <span>处理中 {file.progress}%</span>
                        </div>
                      )}
                      
                      {file.status === FILE_STATUS.COMPLETED && (
                        <div className="file-status success">
                          <span>✓ 完成</span>
                        </div>
                      )}
                      
                      {file.status === FILE_STATUS.ERROR && (
                        <div className="file-status error">
                          <span>✗ {file.error}</span>
                        </div>
                      )}
                    </div>

                    <div className="file-actions">
                      {file.status === FILE_STATUS.COMPLETED && (
                        <button 
                          onClick={() => downloadFile(file)} 
                          className="download-single-btn"
                        >
                          下载
                        </button>
                      )}
                      {file.status !== FILE_STATUS.PROCESSING && (
                        <button 
                          onClick={() => removeFile(file.id)} 
                          className="remove-btn"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="metadata-section">
              <div className="metadata-form">
                <h3>批量元数据设置</h3>
                <p className="form-hint">以下设置将应用于所有视频文件</p>
                
                <div className="form-group">
                  <label>视频标题</label>
                  <input
                    type="text"
                    value={metadata.title}
                    onChange={(e) => handleMetadataChange('title', e.target.value)}
                    placeholder="输入视频标题"
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>作者/艺术家</label>
                  <input
                    type="text"
                    value={metadata.author}
                    onChange={(e) => handleMetadataChange('author', e.target.value)}
                    placeholder="输入作者名称"
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>版权信息</label>
                  <input
                    type="text"
                    value={metadata.copyright}
                    onChange={(e) => handleMetadataChange('copyright', e.target.value)}
                    placeholder="输入版权信息"
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>描述信息</label>
                  <textarea
                    value={metadata.description}
                    onChange={(e) => handleMetadataChange('description', e.target.value)}
                    placeholder="输入视频描述"
                    rows={3}
                    disabled={isProcessing}
                  />
                </div>

                <button
                  onClick={processAllFiles}
                  disabled={isProcessing || !isFFmpegLoaded}
                  className="process-btn"
                >
                  {isProcessing ? (
                    <>
                      <span className="spinner"></span>
                      批量处理中...
                    </>
                  ) : !isFFmpegLoaded ? (
                    '加载 FFmpeg...'
                  ) : (
                    `开始处理 ${videoFiles.length} 个文件`
                  )}
                </button>

                {hasCompleted && (
                  <button onClick={downloadAll} className="download-all-btn">
                    批量下载全部 ({completedCount})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>基于 FFmpeg.wasm 构建 | 所有处理在浏览器本地完成，数据不会上传</p>
      </footer>
    </div>
  )
}

export default App
