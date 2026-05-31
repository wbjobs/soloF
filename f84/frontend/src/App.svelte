<script>
  import { onMount } from 'svelte'
  import ForceGraph from './ForceGraph.svelte'
  import FileList from './FileList.svelte'
  import DetailPanel from './DetailPanel.svelte'
  import StatsPanel from './StatsPanel.svelte'
  import BuildForm from './BuildForm.svelte'
  import TaskProgress from './TaskProgress.svelte'

  let graphData = { nodes: [], edges: [] }
  let stats = { total_files: 0, total_dependencies: 0, external_packages: 0 }
  let selectedFile = null
  let loading = true
  let error = null
  let showExternal = true
  let repoPath = ''
  let activeTaskId = null
  let isBuilding = false

  let predictions = []
  let predictionsLoading = false
  let predictionError = null
  let modelStatus = null
  let modelTraining = false
  let predictedFiles = new Set()
  let predictionScores = new Map()

  async function fetchGraph() {
    loading = true
    error = null
    try {
      const res = await fetch('/api/graph')
      if (!res.ok) throw new Error('Failed to fetch graph data')
      graphData = await res.json()
    } catch (e) {
      error = e.message
    } finally {
      loading = false
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) {
        stats = await res.json()
      }
    } catch (e) {
      console.error('Failed to fetch stats:', e)
    }
  }

  async function fetchModelStatus() {
    if (!repoPath) return
    try {
      const res = await fetch(`/api/predict/model/status?repo_path=${encodeURIComponent(repoPath)}`)
      if (res.ok) {
        modelStatus = await res.json()
      }
    } catch (e) {
      console.error('Failed to fetch model status:', e)
    }
  }

  async function trainModel() {
    if (!repoPath) {
      error = '请先分析一个项目'
      return
    }

    modelTraining = true
    predictionError = null

    try {
      const res = await fetch('/api/predict/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_path: repoPath, branch: 'main', max_commits: 500 })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Training failed' }))
        throw new Error(errData.detail || 'Training failed')
      }

      const result = await res.json()
      modelStatus = {
        is_trained: true,
        total_commits: result.total_commits,
        total_files: result.total_files,
        total_co_change_patterns: result.co_change_patterns
      }

      if (selectedFile) {
        await fetchPredictions(selectedFile.id)
      }
    } catch (e) {
      predictionError = e.message
    } finally {
      modelTraining = false
    }
  }

  async function fetchPredictions(filePath) {
    if (!repoPath) return

    predictionsLoading = true
    predictionError = null

    try {
      const res = await fetch(
        `/api/predict/${encodeURIComponent(filePath)}?repo_path=${encodeURIComponent(repoPath)}&top_n=5`
      )

      if (!res.ok) {
        if (res.status === 400) {
          predictionError = '模型未训练，请先训练预测模型'
        } else {
          const errData = await res.json().catch(() => ({ detail: 'Prediction failed' }))
          throw new Error(errData.detail || 'Prediction failed')
        }
        predictions = []
        predictedFiles = new Set()
        predictionScores = new Map()
        return
      }

      const data = await res.json()
      predictions = data.predictions || []

      predictedFiles = new Set(predictions.map(p => p.file))
      predictionScores = new Map(predictions.map((p, i) => [p.file, {
        rank: i + 1,
        probability: p.probability,
        confidence: p.confidence,
        co_change_count: p.co_change_count
      }]))

    } catch (e) {
      predictionError = e.message
      predictions = []
      predictedFiles = new Set()
      predictionScores = new Map()
    } finally {
      predictionsLoading = false
    }
  }

  async function handleBuild(path) {
    repoPath = path
    isBuilding = true
    error = null
    predictions = []
    predictedFiles = new Set()
    predictionScores = new Map()

    try {
      const res = await fetch('/webhook/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_path: path })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Build failed' }))
        throw new Error(errData.detail || 'Build failed')
      }
      const data = await res.json()
      activeTaskId = data.task_id
    } catch (e) {
      error = e.message
      isBuilding = false
    }
  }

  function handleTaskComplete() {
    isBuilding = false
    activeTaskId = null
    fetchGraph()
    fetchStats()
    fetchModelStatus()
  }

  function handleTaskFailed(e) {
    isBuilding = false
    activeTaskId = null
    error = e?.error || '任务失败'
  }

  function handleTaskCancelled() {
    isBuilding = false
    activeTaskId = null
  }

  async function selectFile(file) {
    selectedFile = file
    if (modelStatus?.is_trained) {
      await fetchPredictions(file.id)
    }
  }

  function clearSelection() {
    selectedFile = null
    predictions = []
    predictedFiles = new Set()
    predictionScores = new Map()
  }

  $: filteredNodes = showExternal
    ? graphData.nodes
    : graphData.nodes.filter(n => !n.is_external)

  $: filteredEdges = showExternal
    ? graphData.edges
    : graphData.edges.filter(e => {
        const sourceNode = graphData.nodes.find(n => n.id === e.source)
        const targetNode = graphData.nodes.find(n => n.id === e.target)
        return (!sourceNode || !sourceNode.is_external) && (!targetNode || !targetNode.is_external)
      })

  onMount(async () => {
    await fetchGraph()
    await fetchStats()
  })
</script>

<svelte:head>
  <title>JS/TS 依赖分析图</title>
</svelte:head>

<main>
  <header>
    <h1>🔗 JS/TS 依赖分析器</h1>
    <div class="header-actions">
      <StatsPanel {stats} />
      {#if modelStatus && modelStatus.is_trained}
        <div class="model-status" title="预测模型已训练">
          <span class="model-dot trained"></span>
          <span class="model-text">🤖 预测模型 ({modelStatus.total_commits} commits)</span>
        </div>
      {/if}
      {#if repoPath}
        <button
          class="btn train-btn"
          on:click={trainModel}
          disabled={modelTraining}
          title="基于Git历史训练变更预测模型"
        >
          {modelTraining ? '⏳ 训练中...' : '🤖 训练预测模型'}
        </button>
      {/if}
      <label class="toggle">
        <input type="checkbox" bind:checked={showExternal} />
        显示外部包
      </label>
      <button class="btn" on:click={fetchGraph} disabled={loading || isBuilding}>🔄 刷新</button>
    </div>
  </header>

  {#if error}
    <div class="error-banner">
      ⚠️ {error}
    </div>
  {/if}

  {#if predictionError && !modelTraining}
    <div class="warning-banner">
      📊 {predictionError}
      {#if repoPath}
        <button class="inline-btn" on:click={trainModel} disabled={modelTraining}>
          {modelTraining ? '训练中...' : '立即训练'}
        </button>
      {/if}
    </div>
  {/if}

  {#if activeTaskId}
    <div class="task-progress-overlay">
      <TaskProgress
        taskId={activeTaskId}
        autoConnect={true}
        on:completed={handleTaskComplete}
        on:failed={handleTaskFailed}
        on:cancelled={handleTaskCancelled}
      />
    </div>
  {/if}

  <div class="container">
    <aside class="sidebar">
      <FileList
        files={graphData.nodes}
        selectedFile={selectedFile}
        predictedFiles={predictedFiles}
        predictionScores={predictionScores}
        on:select={selectFile}
        on:clear={clearSelection}
      />
    </aside>

    <section class="graph-area">
      {#if loading}
        <div class="loading">加载中...</div>
      {:else if filteredNodes.length === 0}
        <div class="empty">
          <p>📊 暂无数据</p>
          <p class="hint">输入项目路径进行分析:</p>
          <BuildForm on:build={handleBuild} disabled={isBuilding} />
          {#if isBuilding}
            <div class="queued-hint">任务排队中...</div>
          {/if}
        </div>
      {:else}
        <ForceGraph
          nodes={filteredNodes}
          edges={filteredEdges}
          selectedFile={selectedFile}
          predictedFiles={predictedFiles}
          predictionScores={predictionScores}
          on:select={selectFile}
        />
      {/if}
    </section>

    <aside class="detail-panel">
      <DetailPanel
        file={selectedFile}
        predictions={predictions}
        predictionsLoading={predictionsLoading}
        predictionError={predictionError}
        modelStatus={modelStatus}
        repoPath={repoPath}
        on:clear={clearSelection}
        on:train={trainModel}
      />
    </aside>
  </div>
</main>

<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  main {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #1a1a2e;
    color: #eee;
    position: relative;
  }

  header {
    background: #16213e;
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #0f3460;
  }

  header h1 {
    font-size: 18px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .model-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #888;
  }

  .model-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #666;
  }

  .model-dot.trained {
    background: #8b5cf6;
    box-shadow: 0 0 8px #8b5cf6;
    animation: glow 2s infinite;
  }

  .model-text {
    color: #a78bfa;
  }

  @keyframes glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .train-btn {
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
  }

  .train-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #a78bfa, #818cf8);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .btn {
    background: #e94560;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.2s;
  }

  .btn:hover:not(:disabled) {
    background: #ff6b81;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-banner {
    background: #e94560;
    padding: 10px 24px;
    font-size: 14px;
  }

  .warning-banner {
    background: rgba(139, 92, 246, 0.2);
    border-bottom: 1px solid rgba(139, 92, 246, 0.3);
    padding: 10px 24px;
    font-size: 14px;
    color: #a78bfa;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .inline-btn {
    background: #8b5cf6;
    color: white;
    border: none;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .inline-btn:hover:not(:disabled) {
    background: #a78bfa;
  }

  .inline-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .task-progress-overlay {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    border-radius: 12px;
  }

  .container {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .sidebar {
    width: 280px;
    background: #16213e;
    border-right: 1px solid #0f3460;
    overflow-y: auto;
  }

  .graph-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #0f0f23;
  }

  .detail-panel {
    width: 320px;
    background: #16213e;
    border-left: 1px solid #0f3460;
    overflow-y: auto;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 16px;
    color: #888;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    gap: 8px;
  }

  .empty .hint {
    font-size: 13px;
  }

  .queued-hint {
    margin-top: 12px;
    font-size: 12px;
    color: #f59e0b;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
