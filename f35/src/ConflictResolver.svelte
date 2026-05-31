<script>
  import { createEventDispatcher } from 'svelte';
  import DiffViewer from './DiffViewer.svelte';

  export let conflict;
  
  const dispatch = createEventDispatcher();

  let selectedVersion = 'merge'; // 'local', 'remote', 'merge'
  let showPreview = true;

  function formatDate(timestamp) {
    if (!timestamp) return '未知';
    return new Date(timestamp * 1000).toLocaleString();
  }

  function handleResolve(version) {
    dispatch('resolve', {
      conflict,
      version,
      content: version === 'local' ? conflict.localContent : conflict.remoteContent
    });
  }

  function getFileSize(content) {
    return (new Blob([content]).size / 1024).toFixed(2) + ' KB';
  }
</script>

<div class="conflict-overlay" on:click|stopPropagation={() => {}}>
  <div class="conflict-modal">
    <div class="modal-header">
      <h2>⚠️ 文件冲突检测</h2>
      <p>本地和远程版本都有修改，请选择要保留的版本</p>
    </div>

    <div class="conflict-info">
      <div class="file-info">
        <span class="file-icon">📄</span>
        <span class="file-name">{conflict.fileName}</span>
        <span class="file-path">{conflict.filePath}</span>
      </div>
      
      <div class="version-comparison">
        <div class="version-card local">
          <h3>💻 本地版本</h3>
          <div class="version-meta">
            <p>🕐 修改时间: {formatDate(conflict.localModified)}</p>
            <p>📊 大小: {getFileSize(conflict.localContent)}</p>
            <p>📝 行数: {conflict.localContent.split('\n').length}</p>
          </div>
        </div>
        
        <div class="version-vs">VS</div>
        
        <div class="version-card remote">
          <h3>🌐 远程版本</h3>
          <div class="version-meta">
            <p>🕐 修改时间: {formatDate(conflict.remoteModified)}</p>
            <p>📊 大小: {getFileSize(conflict.remoteContent)}</p>
            <p>📝 行数: {conflict.remoteContent.split('\n').length}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="diff-container">
      <div class="diff-toolbar">
        <span class="diff-title">差异预览</span>
        <button 
          class="toggle-btn" 
          on:click={() => showPreview = !showPreview}
        >
          {showPreview ? '🔼 隐藏' : '🔽 显示'}差异
        </button>
      </div>
      
      {#if showPreview}
        <div class="diff-wrapper">
          <DiffViewer 
            localContent={conflict.localContent}
            remoteContent={conflict.remoteContent}
            fileName={conflict.fileName}
          />
        </div>
      {/if}
    </div>

    <div class="resolve-options">
      <h4>选择解决方式:</h4>
      
      <div class="option-buttons">
        <button 
          class="resolve-btn local"
          class:active={selectedVersion === 'local'}
          on:click={() => selectedVersion = 'local'}
        >
          💻 保留本地版本
          <span class="btn-hint">本地修改将被保留</span>
        </button>
        
        <button 
          class="resolve-btn remote"
          class:active={selectedVersion === 'remote'}
          on:click={() => selectedVersion = 'remote'}
        >
          🌐 使用远程版本
          <span class="btn-hint">将覆盖本地修改</span>
        </button>
      </div>
    </div>

    <div class="modal-actions">
      <button class="cancel-btn" on:click={() => dispatch('cancel')}>
        ❌ 稍后处理
      </button>
      <button 
        class="confirm-btn"
        disabled={!selectedVersion}
        on:click={() => handleResolve(selectedVersion)}
      >
        ✅ 确认并解决冲突
      </button>
    </div>
  </div>
</div>

<style>
  .conflict-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .conflict-modal {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    padding: 20px 24px;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
  }

  .modal-header h2 {
    margin: 0 0 8px 0;
    font-size: 24px;
  }

  .modal-header p {
    margin: 0;
    opacity: 0.9;
    font-size: 14px;
  }

  .conflict-info {
    padding: 20px 24px;
    border-bottom: 1px solid #e0e0e0;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px;
    background: #f8f9fa;
    border-radius: 8px;
  }

  .file-icon {
    font-size: 24px;
  }

  .file-name {
    font-weight: 600;
    font-size: 16px;
    color: #2c3e50;
  }

  .file-path {
    font-size: 12px;
    color: #7f8c8d;
    margin-left: auto;
  }

  .version-comparison {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .version-card {
    flex: 1;
    padding: 16px;
    border-radius: 8px;
    border: 2px solid transparent;
  }

  .version-card.local {
    background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%);
    border-color: #667eea;
  }

  .version-card.remote {
    background: linear-gradient(135deg, #f093fb20 0%, #f5576c20 100%);
    border-color: #f5576c;
  }

  .version-card h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: #2c3e50;
  }

  .version-meta p {
    margin: 4px 0;
    font-size: 12px;
    color: #576574;
  }

  .version-vs {
    font-weight: bold;
    font-size: 20px;
    color: #95a5a6;
  }

  .diff-container {
    border-bottom: 1px solid #e0e0e0;
  }

  .diff-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 24px;
    background: #f8f9fa;
  }

  .diff-title {
    font-weight: 600;
    color: #2c3e50;
  }

  .toggle-btn {
    padding: 6px 12px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .toggle-btn:hover {
    background: #f0f0f0;
  }

  .diff-wrapper {
    height: 300px;
    overflow: hidden;
  }

  .resolve-options {
    padding: 20px 24px;
  }

  .resolve-options h4 {
    margin: 0 0 16px 0;
    color: #2c3e50;
  }

  .option-buttons {
    display: flex;
    gap: 16px;
  }

  .resolve-btn {
    flex: 1;
    padding: 16px 20px;
    border: 2px solid #ddd;
    border-radius: 8px;
    background: white;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .resolve-btn:hover {
    border-color: #3498db;
    background: #f8f9fa;
  }

  .resolve-btn.active {
    border-color: #27ae60;
    background: #d5f4e6;
  }

  .resolve-btn.local {
    border-color: #667eea;
  }

  .resolve-btn.local:hover,
  .resolve-btn.local.active {
    background: #667eea20;
  }

  .resolve-btn.remote {
    border-color: #f5576c;
  }

  .resolve-btn.remote:hover,
  .resolve-btn.remote.active {
    background: #f5576c20;
  }

  .resolve-btn span:first-child {
    display: block;
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 4px;
  }

  .btn-hint {
    font-size: 11px;
    color: #7f8c8d;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 20px 24px;
    background: #f8f9fa;
  }

  .cancel-btn {
    padding: 10px 20px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .cancel-btn:hover {
    background: #f0f0f0;
  }

  .confirm-btn {
    padding: 10px 24px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .confirm-btn:hover:not(:disabled) {
    background: #229954;
  }

  .confirm-btn:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
  }
</style>
