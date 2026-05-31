<script>
  import { createEventDispatcher } from 'svelte'

  export let files = []
  export let selectedFile = null
  export let predictedFiles = new Set()
  export let predictionScores = new Map()

  const dispatch = createEventDispatcher()

  let searchQuery = ''

  $: filteredFiles = files.filter(f => {
    if (!searchQuery) return true
    return f.id.toLowerCase().includes(searchQuery.toLowerCase())
  })

  $: projectFiles = filteredFiles.filter(f => !f.is_external)
  $: externalFiles = filteredFiles.filter(f => f.is_external)

  function selectFile(file) {
    dispatch('select', file)
  }

  function clearSelection() {
    dispatch('clear')
  }

  function getFileIcon(file) {
    if (predictedFiles.has(file.id)) return '🎯'
    if (file.is_external) return '📦'
    if (file.id.endsWith('.tsx') || file.id.endsWith('.jsx')) return '⚛️'
    if (file.id.endsWith('.ts')) return '🔷'
    if (file.id.endsWith('.js')) return '🟨'
    return '📄'
  }

  function getFileName(file) {
    const parts = file.id.split('/')
    return parts[parts.length - 1]
  }

  function getFileDir(file) {
    const parts = file.id.split('/')
    parts.pop()
    return parts.join('/') || '.'
  }

  function getPredictionRank(file) {
    const score = predictionScores.get(file.id)
    return score ? `#${score.rank}` : ''
  }
</script>

<div class="file-list">
  <div class="search-box">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="🔍 搜索文件..."
    />
  </div>

  {#if predictedFiles.size > 0}
    <div class="prediction-header">
      <span class="prediction-icon">🎯</span>
      <span>预测影响: {predictedFiles.size} 个文件</span>
    </div>
  {/if}

  {#if projectFiles.length > 0}
    <div class="section-title">📁 项目文件 ({projectFiles.length})</div>
    <div class="file-items">
      {#each projectFiles as file (file.id)}
        <div
          class="file-item"
          class:selected={selectedFile && selectedFile.id === file.id}
          class:predicted={predictedFiles.has(file.id)}
          on:click={() => selectFile(file)}
          on:dblclick={clearSelection}
        >
          <span class="icon">{getFileIcon(file)}</span>
          <div class="file-info">
            <div class="file-name">
              {getFileName(file)}
              {#if predictedFiles.has(file.id)}
                <span class="prediction-badge">{getPredictionRank(file)}</span>
              {/if}
            </div>
            <div class="file-dir">{getFileDir(file)}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if externalFiles.length > 0}
    <div class="section-title">📦 外部依赖 ({externalFiles.length})</div>
    <div class="file-items">
      {#each externalFiles as file (file.id)}
        <div
          class="file-item external"
          class:selected={selectedFile && selectedFile.id === file.id}
          class:predicted={predictedFiles.has(file.id)}
          on:click={() => selectFile(file)}
          on:dblclick={clearSelection}
        >
          <span class="icon">{getFileIcon(file)}</span>
          <div class="file-info">
            <div class="file-name">
              {getFileName(file)}
              {#if predictedFiles.has(file.id)}
                <span class="prediction-badge">{getPredictionRank(file)}</span>
              {/if}
            </div>
            <div class="file-dir">{file.package_name || file.id}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .file-list {
    height: 100%;
    overflow-y: auto;
    padding: 12px;
  }

  .search-box {
    margin-bottom: 12px;
  }

  .search-box input {
    width: 100%;
    background: #1a1a2e;
    border: 1px solid #0f3460;
    color: #eee;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
  }

  .search-box input:focus {
    outline: none;
    border-color: #e94560;
  }

  .prediction-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(139, 92, 246, 0.2);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 6px;
    font-size: 13px;
    color: #a78bfa;
    margin-bottom: 12px;
  }

  .prediction-icon {
    font-size: 14px;
  }

  .section-title {
    font-size: 12px;
    color: #888;
    margin: 16px 0 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .file-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    border: 1px solid transparent;
  }

  .file-item:hover {
    background: #1a1a2e;
  }

  .file-item.selected {
    background: #e94560;
  }

  .file-item.selected .file-name,
  .file-item.selected .file-dir {
    color: #fff;
  }

  .file-item.predicted {
    border-color: rgba(139, 92, 246, 0.5);
    background: rgba(139, 92, 246, 0.1);
  }

  .file-item.predicted:hover {
    background: rgba(139, 92, 246, 0.2);
  }

  .file-item.predicted.selected {
    background: linear-gradient(135deg, #e94560, #8b5cf6);
    border-color: #8b5cf6;
  }

  .icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .file-info {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    font-size: 13px;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .file-dir {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-item.external .file-name {
    color: #f59e0b;
  }

  .file-item.external.predicted .file-name {
    color: #a78bfa;
  }

  .prediction-badge {
    background: #8b5cf6;
    color: white;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
</style>
