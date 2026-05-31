<script>
  import { invoke } from '@tauri-apps/api/tauri'
  import { open } from '@tauri-apps/api/dialog'
  import { listen } from '@tauri-apps/api/event'
  import { onMount, onDestroy } from 'svelte'
  import Heatmap from './components/Heatmap.svelte'
  import StackedArea from './components/StackedArea.svelte'
  import CodeOwnership from './components/CodeOwnership.svelte'

  let repoPath = ''
  let loading = false
  let commits = []
  let authorStats = {}
  let codeOwnership = []
  let error = ''
  let progress = null
  let unlisten = null

  onMount(async () => {
    unlisten = await listen('analysis_progress', (event) => {
      progress = event.payload
    })
  })

  onDestroy(() => {
    if (unlisten) {
      unlisten()
    }
  })

  async function selectRepo() {
    const selected = await open({
      directory: true,
      multiple: false
    })
    if (selected) {
      repoPath = selected
      await analyzeRepo()
    }
  }

  async function analyzeRepo() {
    loading = true
    error = ''
    progress = null
    commits = []
    authorStats = {}
    codeOwnership = []
    try {
      const result = await invoke('analyze_repo', { path: repoPath })
      commits = result.commits
      authorStats = result.author_stats
      codeOwnership = result.code_ownership || []
    } catch (e) {
      error = e.toString()
    } finally {
      loading = false
      progress = null
    }
  }

  function getProgressPercent() {
    if (!progress) return 0
    if (progress.total === 0) return 0
    return Math.min(100, Math.round((progress.current / progress.total) * 100))
  }

  function getStageText(stage) {
    const stageMap = {
      loading: '加载仓库',
      collecting: '收集提交',
      processing: '分析差异',
      stats: '计算统计',
      ownership: '代码所有权',
      complete: '完成'
    }
    return stageMap[stage] || stage
  }
</script>

<main>
  <h1>Git 仓库分析器</h1>
  
  <div class="controls">
    <button on:click={selectRepo} disabled={loading}>
      {loading ? '分析中...' : '选择仓库'}
    </button>
    {#if repoPath}
      <p class="path">当前仓库: {repoPath}</p>
    {/if}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if progress}
    <div class="progress-container">
      <div class="progress-header">
        <span class="stage">{getStageText(progress.stage)}</span>
        <span class="percent">{getProgressPercent()}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {getProgressPercent()}%"></div>
      </div>
      <p class="progress-message">{progress.message}</p>
    </div>
  {/if}

  {#if commits.length > 0}
    <div class="stats">
      <h2>统计概览</h2>
      <p>总提交数: {commits.length}</p>
      <p>贡献者数: {Object.keys(authorStats).length}</p>
    </div>

    <div class="visualizations">
      <Heatmap {commits} />
      <StackedArea {commits} {authorStats} />
      {#if codeOwnership.length > 0}
        <CodeOwnership ownership={codeOwnership} />
      {/if}
    </div>
  {/if}
</main>

<style>
  main {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  h1 {
    color: #333;
    text-align: center;
  }

  .controls {
    text-align: center;
    margin: 30px 0;
  }

  button {
    padding: 12px 24px;
    font-size: 16px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s;
  }

  button:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }

  button:not(:disabled):hover {
    background: #4338ca;
  }

  .path {
    margin-top: 15px;
    color: #64748b;
    font-size: 14px;
    word-break: break-all;
  }

  .error {
    background: #fee2e2;
    color: #dc2626;
    padding: 16px;
    border-radius: 8px;
    text-align: center;
    margin: 20px 0;
  }

  .progress-container {
    background: #f8fafc;
    padding: 24px;
    border-radius: 12px;
    margin: 20px 0;
    border: 1px solid #e2e8f0;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .stage {
    font-weight: 600;
    color: #1e293b;
    font-size: 14px;
  }

  .percent {
    color: #4f46e5;
    font-weight: 600;
    font-size: 14px;
  }

  .progress-bar {
    width: 100%;
    height: 12px;
    background: #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4f46e5, #818cf8);
    border-radius: 6px;
    transition: width 0.3s ease;
  }

  .progress-message {
    margin-top: 12px;
    color: #64748b;
    font-size: 13px;
    text-align: center;
  }

  .stats {
    background: #f8fafc;
    padding: 24px;
    border-radius: 12px;
    margin: 20px 0;
  }

  .stats h2 {
    margin-top: 0;
    color: #1e293b;
    font-size: 18px;
  }

  .stats p {
    color: #475569;
    margin: 8px 0;
  }

  .visualizations {
    display: flex;
    flex-direction: column;
    gap: 40px;
    margin-top: 30px;
  }
</style>
