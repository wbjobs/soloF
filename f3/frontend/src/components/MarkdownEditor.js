import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { updateMarkdown, getDownloadUrl } from '../services/api';
import './MarkdownEditor.css';

const MarkdownEditor = ({ fileId, initialContent, filename }) => {
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateMarkdown(fileId, content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('保存失败:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      const result = await getDownloadUrl(fileId);
      window.open(result.download_url, '_blank');
    } catch (error) {
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'converted.md';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="markdown-editor-container">
      <div className="editor-header">
        <h3>📝 Markdown 编辑器</h3>
        <div className="editor-actions">
          <div className="editor-tabs">
            <button
              className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
              onClick={() => setActiveTab('edit')}
            >
              编辑
            </button>
            <button
              className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              预览
            </button>
            <button
              className={`tab-btn ${activeTab === 'split' ? 'active' : ''}`}
              onClick={() => setActiveTab('split')}
            >
              分屏
            </button>
          </div>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : saveSuccess ? '✓ 已保存' : '💾 保存'}
          </button>
          <button className="download-btn" onClick={handleDownload}>
            ⬇️ 下载
          </button>
        </div>
      </div>

      <div className={`editor-content ${activeTab}`}>
        {(activeTab === 'edit' || activeTab === 'split') && (
          <div className="editor-pane">
            <textarea
              className="markdown-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此编辑Markdown内容..."
              spellCheck={false}
            />
          </div>
        )}

        {(activeTab === 'preview' || activeTab === 'split') && (
          <div className="preview-pane">
            <div className="markdown-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;
