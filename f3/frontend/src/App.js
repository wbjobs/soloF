import React, { useState, useEffect } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import ProgressBar from './components/ProgressBar';
import MarkdownEditor from './components/MarkdownEditor';
import FormulaPreview from './components/FormulaPreview';
import CitationPreview from './components/CitationPreview';
import { getTaskStatus, getConversionResult } from './services/api';

function App() {
  const [currentStep, setCurrentStep] = useState('upload');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionMessage, setConversionMessage] = useState('');
  const [taskId, setTaskId] = useState(null);
  const [fileId, setFileId] = useState(null);
  const [filename, setFilename] = useState('');
  const [conversionResult, setConversionResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeResultTab, setActiveResultTab] = useState('formulas');

  useEffect(() => {
    let pollInterval;

    if (taskId && currentStep === 'converting') {
      pollInterval = setInterval(async () => {
        try {
          const status = await getTaskStatus(taskId);
          setConversionProgress(status.progress || 0);
          setConversionMessage(status.message || '');

          if (status.status === 'SUCCESS') {
            clearInterval(pollInterval);
            setFileId(status.data.file_id);
            loadResult(status.data.file_id);
          } else if (status.status === 'FAILURE') {
            clearInterval(pollInterval);
            setError(status.message || '转换失败');
            setCurrentStep('error');
          }
        } catch (err) {
          console.error('轮询任务状态失败:', err);
        }
      }, 1000);
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [taskId, currentStep]);

  const loadResult = async (id) => {
    try {
      const result = await getConversionResult(id);
      setConversionResult(result);
      setCurrentStep('result');
    } catch (err) {
      setError('加载转换结果失败');
      setCurrentStep('error');
    }
  };

  const handleUploadStart = () => {
    setCurrentStep('uploading');
    setUploadProgress(0);
    setError(null);
  };

  const handleUploadProgress = (progress) => {
    setUploadProgress(progress);
  };

  const handleUploadComplete = (data) => {
    setTaskId(data.task_id);
    setFileId(data.file_id);
    setFilename(data.filename);
    setCurrentStep('converting');
  };

  const handleUploadError = (err) => {
    setError(err.message || '上传失败');
    setCurrentStep('error');
  };

  const handleReset = () => {
    setCurrentStep('upload');
    setUploadProgress(0);
    setConversionProgress(0);
    setTaskId(null);
    setFileId(null);
    setFilename('');
    setConversionResult(null);
    setError(null);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>📄 PDF to Markdown 转换器</h1>
        <p>智能识别科研论文中的数学公式，完美转换为LaTeX</p>
      </header>

      <main className="App-main">
        {currentStep === 'upload' && (
          <FileUpload
            onUploadStart={handleUploadStart}
            onUploadProgress={handleUploadProgress}
            onUploadComplete={handleUploadComplete}
            onUploadError={handleUploadError}
          />
        )}

        {currentStep === 'uploading' && (
          <div className="progress-container">
            <h2>正在上传文件...</h2>
            <ProgressBar progress={uploadProgress} label="上传进度" />
          </div>
        )}

        {currentStep === 'converting' && (
          <div className="progress-container">
            <h2>正在转换中...</h2>
            <p className="conversion-message">{conversionMessage}</p>
            <ProgressBar progress={conversionProgress} label="转换进度" />
            <p className="filename">文件: {filename}</p>
          </div>
        )}

        {currentStep === 'result' && conversionResult && (
          <div className="result-container">
            <div className="result-header">
              <h2>转换完成！</h2>
              <div className="result-stats">
                <span>📄 {conversionResult.pages_count || 0} 页</span>
                <span>🔢 {conversionResult.formulas?.length || 0} 个公式</span>
                <span>📚 {conversionResult.citation_count || 0} 个引用</span>
              </div>
              <button className="reset-btn" onClick={handleReset}>
                转换新文件
              </button>
            </div>

            <div className="result-tabs">
              <button
                className={`result-tab-btn ${activeResultTab === 'formulas' ? 'active' : ''}`}
                onClick={() => setActiveResultTab('formulas')}
              >
                🔢 数学公式 ({conversionResult.formulas?.length || 0})
              </button>
              <button
                className={`result-tab-btn ${activeResultTab === 'citations' ? 'active' : ''}`}
                onClick={() => setActiveResultTab('citations')}
              >
                📚 参考文献 ({conversionResult.citation_count || 0})
              </button>
            </div>

            <div className={`result-content ${activeResultTab}`}>
              {activeResultTab === 'formulas' && (
                <>
                  <FormulaPreview formulas={conversionResult.formulas || []} />
                  <MarkdownEditor
                    fileId={fileId}
                    initialContent={conversionResult.markdown || ''}
                    filename={conversionResult.md_filename}
                  />
                </>
              )}
              {activeResultTab === 'citations' && (
                <CitationPreview
                  citations={conversionResult.citations || []}
                  citationCount={conversionResult.citation_count || 0}
                  citationWithDoi={conversionResult.citation_with_doi || 0}
                />
              )}
            </div>
          </div>
        )}

        {currentStep === 'error' && (
          <div className="error-container">
            <h2>❌ 出错了</h2>
            <p className="error-message">{error}</p>
            <button className="reset-btn" onClick={handleReset}>
              重新开始
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
