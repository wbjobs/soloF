<script>
  import { onMount } from 'svelte'
  import { createEventDispatcher } from 'svelte'

  export let file = null
  export let predictions = []
  export let predictionsLoading = false
  export let predictionError = null
  export let modelStatus = null
  export let repoPath = null

  const dispatch = createEventDispatcher()

  let references = []
  let impact = null
  let loading = false

  async function fetchReferences() {
    if (!file) return
    loading = true
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(file.id)}/references?recursive=true`)
      if (res.ok) {
        const data = await res.json()
        references = data.references || []
      }
    } catch (e) {
      console.error('Failed to fetch references:', e)
    } finally {
      loading = false
    }
  }

  async function fetchImpact() {
    if (!file) return
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(file.id)}/impact`)
      if (res.ok) {
        impact = await res.json()
      }
    } catch (e) {
      console.error('Failed to fetch impact:', e)
    }
  }

  function clearSelection() {
    dispatch('clear')
  }

  function trainModel() {
    dispatch('train')
  }

  function getFileName(f) {
    if (!f) return ''
    const parts = (f.file || f.id || '').split('/')
    return parts[parts.length - 1]
  }

  function getConfidenceColor(confidence) {
    if (confidence >= 0.7) return '#10b981'
    if (confidence >= 0.4) return '#f59e0b'
    return '#ef4444'
  }

  $: if (file) {
    references = []
    impact = null
    fetchReferences()
    fetchImpact()
  }
</script>

{#if file}
  <div class="detail-panel">
    <div class="panel-header">
      <h3>文件详情</h3>
      <button class="close-btn" on:click={clearSelection}>✕</button>
    </div>

    <div class="file-info">
      <div class="file-icon">{file.is_external ? '📦' : '📄'}</div>
      <div class="file-meta">
        <div class="file-path" title={file.id}>{file.id}</div>
        <div class="file-type">
          {#if file.is_external}
            <span class="badge external">外部依赖</span>
          {:else}
            <span class="badge project">项目文件</span>
          {/if}
        </div>
      </div>
    </div>

    {#if !file.is_external && modelStatus && !modelStatus.is_trained}
      <div class="train-prompt">
        <div class="prompt-icon">🤖</div>
        <div class="prompt-content">
          <div class="prompt-title">启用变更预测</div>
          <div class="prompt-desc">基于 Git 历史训练预测模型，可预测修改该文件后最可能受影响的文件</div>
          <button class="train-small-btn" on:click={trainModel}>立即训练</button>
        </div>
      </div>
    {/if}

    {#if predictions.length > 0}
      <div class="section prediction-section">
        <div class="section-header">
          <h4>🎯 变更影响预测 (Top 5)</h4>
          <span class="prediction-subtitle">基于 {modelStatus?.total_commits || 0} 次提交</span>
        </div>

        <div class="prediction-list">
          {#each predictions as pred, index (pred.file)}
            <div class="prediction-item">
              <div class="prediction-rank" style="background: {getConfidenceColor(pred.confidence)}">
                {index + 1}
              </div>
              <div class="prediction-info">
                <div class="prediction-file" title={pred.file}>{getFileName(pred)}</div>
                <div class="prediction-meta">
                  <span class="probability">概率: {(pred.probability * 100).toFixed(1)}%</span>
                  <span class="confidence" style="color: {getConfidenceColor(pred.confidence)}">
                    置信: {(pred.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div class="prediction-reason">{pred.reason}</div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if predictionsLoading}
      <div class="loading-small">🔄 预测计算中...</div>
    {/if}

    {#if predictionError && !file.is_external}
      <div class="error-small">
        📊 {predictionError}
        {#if repoPath}
          <button class="inline-btn-small" on:click={trainModel}>
            立即训练
          </button>
        {/if}
      </div>
    {/if}

    <div class="section">
      <h4>🔗 被引用情况</h4>
      {#if loading}
        <div class="loading-small">加载中...</div>
      {:else if references.length === 0}
        <div class="empty-small">暂无引用</div>
      {:else}
        <div class="ref-list">
          {#each references as ref (ref.file)}
            <div class="ref-item">
              <span class="ref-depth">L{ref.depth || 1}</span>
              <span class="ref-file" title={ref.file}>{getFileName(ref)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if !file.is_external && impact}
      <div class="section">
        <h4>⚠️ 删除影响分析</h4>
        <div class="impact-summary">
          <div class="impact-stat">
            <span class="stat-value">{impact.directly_impacted.length}</span>
            <span class="stat-label">直接影响</span>
          </div>
          <div class="impact-stat">
            <span class="stat-value">{impact.transitively_impacted.length}</span>
            <span class="stat-label">间接影响</span>
          </div>
        </div>

        {#if impact.directly_impacted.length > 0}
          <div class="impact-subsection">
            <h5>直接影响文件</h5>
            <div class="impact-list">
              {#each impact.directly_impacted as item (item.file)}
                <div class="impact-item">{getFileName(item)}</div>
              {/each}
            </div>
          </div>
        {/if}

        {#if impact.transitively_impacted.length > 0}
          <div class="impact-subsection">
            <h5>间接影响文件</h5>
            <div class="impact-list">
              {#each impact.transitively_impacted as item (item.file)}
                <div class="impact-item">{getFileName(item)}</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="empty-panel">
    <div class="placeholder">👆 选择一个文件查看详情</div>
  </div>
{/if}

<style>
  .detail-panel {
    padding: 16px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .panel-header h3 {
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #1a1a2e;
    color: #eee;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px;
    background: #1a1a2e;
    border-radius: 8px;
  }

  .file-icon {
    font-size: 28px;
  }

  .file-meta {
    flex: 1;
    min-width: 0;
  }

  .file-path {
    font-size: 12px;
    color: #eee;
    word-break: break-all;
    font-family: monospace;
  }

  .file-type {
    margin-top: 4px;
  }

  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }

  .badge.project {
    background: #10b981;
    color: #000;
  }

  .badge.external {
    background: #f59e0b;
    color: #000;
  }

  .train-prompt {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .prompt-icon {
    font-size: 24px;
    flex-shrink: 0;
  }

  .prompt-content {
    flex: 1;
  }

  .prompt-title {
    font-size: 13px;
    font-weight: 600;
    color: #a78bfa;
    margin-bottom: 2px;
  }

  .prompt-desc {
    font-size: 11px;
    color: #888;
    margin-bottom: 8px;
    line-height: 1.4;
  }

  .train-small-btn {
    background: #8b5cf6;
    color: white;
    border: none;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .train-small-btn:hover {
    background: #a78bfa;
  }

  .section {
    margin-bottom: 20px;
  }

  .prediction-section {
    padding: 12px;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .section-header h4 {
    margin: 0;
    font-size: 13px;
    color: #a78bfa;
  }

  .prediction-subtitle {
    font-size: 10px;
    color: #666;
  }

  .prediction-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .prediction-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
  }

  .prediction-rank {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .prediction-info {
    flex: 1;
    min-width: 0;
  }

  .prediction-file {
    font-size: 12px;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .prediction-meta {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: #888;
    margin-bottom: 2px;
  }

  .probability {
    font-family: monospace;
  }

  .confidence {
    font-family: monospace;
    font-weight: 600;
  }

  .prediction-reason {
    font-size: 10px;
    color: #666;
    font-style: italic;
  }

  .section h4 {
    font-size: 13px;
    color: #888;
    margin-bottom: 10px;
    font-weight: 600;
  }

  .loading-small {
    font-size: 12px;
    color: #666;
    padding: 12px;
    text-align: center;
  }

  .empty-small {
    font-size: 12px;
    color: #666;
    padding: 12px;
    text-align: center;
  }

  .error-small {
    font-size: 12px;
    color: #a78bfa;
    padding: 10px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 6px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .inline-btn-small {
    background: #8b5cf6;
    color: white;
    border: none;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 10px;
    cursor: pointer;
  }

  .inline-btn-small:hover {
    background: #a78bfa;
  }

  .ref-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }

  .ref-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #1a1a2e;
    border-radius: 6px;
    font-size: 12px;
  }

  .ref-depth {
    background: #0f3460;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    color: #888;
  }

  .ref-file {
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .impact-summary {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
  }

  .impact-stat {
    flex: 1;
    background: #1a1a2e;
    padding: 12px;
    border-radius: 8px;
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 24px;
    font-weight: 700;
    color: #e94560;
  }

  .stat-label {
    font-size: 11px;
    color: #888;
  }

  .impact-subsection {
    margin-top: 12px;
  }

  .impact-subsection h5 {
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
  }

  .impact-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .impact-item {
    background: #1a1a2e;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    color: #eee;
  }

  .empty-panel {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .placeholder {
    color: #666;
    font-size: 14px;
    text-align: center;
  }
</style>
