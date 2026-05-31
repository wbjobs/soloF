<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'

  export let taskId = null
  export let autoConnect = false

  const dispatch = createEventDispatcher()

  let ws = null
  let connected = false
  let taskInfo = null
  let progress = null
  let status = 'idle'
  let message = ''
  let error = null
  let reconnectAttempts = 0
  let reconnectTimer = null

  $: percent = progress && progress.total_files > 0
    ? Math.round((progress.current_file / progress.total_files) * 100)
    : 0

  $: phaseText = progress?.phase || ''
  $: isRunning = status === 'queued' || status === 'running'
  $: isCompleted = status === 'completed'
  $: isFailed = status === 'failed' || status === 'cancelled'
  $: isFinished = isCompleted || isFailed

  function connect(task_id = taskId) {
    if (!task_id) return

    disconnect()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/tasks/${task_id}`

    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        connected = true
        reconnectAttempts = 0
        error = null
        dispatch('connected', { taskId: task_id })
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'init') {
            taskInfo = data.task
            status = data.task.status
            progress = data.task.progress
            message = data.task.progress?.message || ''
          } else if (data.type === 'progress') {
            status = data.data.status
            progress = data.data.progress
            message = data.data.message || progress?.message || ''
          } else if (data.type === 'status_change') {
            status = data.data.status
            message = data.data.message || ''
          } else if (data.type === 'completed') {
            status = 'completed'
            message = '分析完成'
            dispatch('completed', { taskId: task_id, result: data.data.result })
            setTimeout(disconnect, 2000)
          } else if (data.type === 'failed' || data.type === 'error') {
            status = data.type
            error = data.data.error || data.message || '未知错误'
            dispatch('failed', { taskId: task_id, error: error })
          } else if (data.type === 'cancelled') {
            status = 'cancelled'
            message = '任务已取消'
            dispatch('cancelled', { taskId: task_id })
          }

          dispatch('update', { status, progress, message, taskInfo })
        } catch (e) {
          console.error('Failed to parse WS message:', e)
        }
      }

      ws.onclose = () => {
        connected = false
        ws = null
        if (!isFinished && reconnectAttempts < 5) {
          reconnectAttempts++
          reconnectTimer = setTimeout(() => connect(task_id), 2000 * reconnectAttempts)
        }
      }

      ws.onerror = (e) => {
        error = 'WebSocket 连接错误'
      }
    } catch (e) {
      error = e.message
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected = false
  }

  function cancelTask() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'cancel' }))
    }
  }

  function reset() {
    disconnect()
    taskInfo = null
    progress = null
    status = 'idle'
    message = ''
    error = null
    taskId = null
  }

  $: if (autoConnect && taskId && !ws && !isFinished) {
    connect(taskId)
  }

  onDestroy(() => {
    disconnect()
  })

  dispatch('ready', { connect, disconnect, cancelTask, reset })
</script>

{#if isRunning}
  <div class="progress-container">
    <div class="progress-header">
      <div class="status-badge" class:queued={status === 'queued'} class:running={status === 'running'}>
        {status === 'queued' ? '⏳ 排队中' : status === 'running' ? '⚙️ 分析中' : status}
      </div>
      {#if connected}
        <span class="connected-dot" title="已连接">●</span>
      {/if}
      <button class="cancel-btn" on:click={cancelTask} title="取消任务">✕</button>
    </div>

    {#if message}
      <div class="progress-message">{message}</div>
    {/if}

    <div class="progress-bar-wrapper">
      <div class="progress-bar" style={`width: ${percent}%`}></div>
    </div>

    <div class="progress-stats">
      {#if progress}
        <span>{progress.current_file} / {progress.total_files} 个文件</span>
        <span>{percent}%</span>
      {/if}
    </div>

    {#if progress}
      <div class="progress-info">
        <div class="info-item">
          <span class="info-label">节点:</span>
          <span class="info-value">{progress.nodes_created}</span>
        </div>
        <div class="info-item">
          <span class="info-label">边:</span>
          <span class="info-value">{progress.edges_created}</span>
        </div>
        <div class="info-item">
          <span class="info-label">错误:</span>
          <span class="info-value" class:has-errors={progress.errors_count > 0}>{progress.errors_count}</span>
        </div>
      </div>
    {/if}

    {#if phaseText}
      <div class="phase-indicator">
        阶段: {phaseText === 'scanning' ? '🔍 扫描文件' : phaseText === 'parsing' ? '📝 解析 AST' : phaseText === 'building_graph' ? '🗺️ 构建图' : '✅ 完成'}
      </div>
    {/if}
  </div>
{/if}

{#if isCompleted}
  <div class="progress-container completed">
    <div class="status-badge completed">✅ 分析完成</div>
    {#if taskInfo?.result}
      <div class="result-stats">
        <div class="stat-item">
          <span class="stat-value">{taskInfo.result.nodes_created}</span>
          <span class="stat-label">节点</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{taskInfo.result.edges_created}</span>
          <span class="stat-label">边</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{taskInfo.result.files_scanned}</span>
          <span class="stat-label">文件</span>
        </div>
      </div>
      {#if taskInfo.result.errors?.length > 0}
        <div class="warning-text">
          ⚠️ {taskInfo.result.errors.length} 个文件解析失败
        </div>
      {/if}
    {/if}
    <button class="close-btn" on:click={reset}>关闭</button>
  </div>
{/if}

{#if isFailed}
  <div class="progress-container failed">
    <div class="status-badge failed">❌ {status === 'cancelled' ? '任务已取消' : '分析失败'}</div>
    {#if error}
      <div class="error-text">{error}</div>
    {/if}
    <button class="close-btn" on:click={reset}>关闭</button>
  </div>
{/if}

<style>
  .progress-container {
    background: rgba(22, 33, 62, 0.95);
    border: 1px solid #0f3460;
    border-radius: 12px;
    padding: 20px;
    min-width: 400px;
    backdrop-filter: blur(10px);
  }

  .progress-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .status-badge {
    font-size: 14px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 20px;
    background: #0f3460;
    color: #888;
  }

  .status-badge.queued {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
  }

  .status-badge.running {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    animation: pulse 2s infinite;
  }

  .status-badge.completed {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .status-badge.failed {
    background: rgba(233, 69, 96, 0.2);
    color: #e94560;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .connected-dot {
    color: #10b981;
    font-size: 12px;
    animation: pulse 2s infinite;
  }

  .cancel-btn {
    margin-left: auto;
    background: rgba(233, 69, 96, 0.2);
    border: none;
    color: #e94560;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .cancel-btn:hover {
    background: rgba(233, 69, 96, 0.4);
  }

  .progress-message {
    font-size: 13px;
    color: #ccc;
    margin-bottom: 12px;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-bar-wrapper {
    height: 8px;
    background: #0f0f23;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #3b82f6);
    border-radius: 4px;
    transition: width 0.3s ease;
    min-width: 2%;
  }

  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #888;
    margin-bottom: 12px;
  }

  .progress-info {
    display: flex;
    gap: 20px;
    margin-bottom: 12px;
  }

  .info-item {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .info-label {
    font-size: 11px;
    color: #666;
  }

  .info-value {
    font-size: 14px;
    font-weight: 600;
    color: #eee;
    font-family: monospace;
  }

  .info-value.has-errors {
    color: #e94560;
  }

  .phase-indicator {
    font-size: 12px;
    color: #888;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  .result-stats {
    display: flex;
    gap: 30px;
    margin: 16px 0;
    justify-content: center;
  }

  .stat-item {
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 28px;
    font-weight: 700;
    color: #10b981;
  }

  .stat-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
  }

  .warning-text {
    color: #f59e0b;
    font-size: 12px;
    text-align: center;
    margin-bottom: 12px;
  }

  .error-text {
    color: #e94560;
    font-size: 12px;
    padding: 10px;
    background: rgba(233, 69, 96, 0.1);
    border-radius: 6px;
    margin: 12px 0;
    font-family: monospace;
    word-break: break-all;
  }

  .close-btn {
    width: 100%;
    padding: 8px;
    background: #0f3460;
    border: none;
    color: #eee;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    margin-top: 8px;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: #1a4a7a;
  }

  .progress-container.completed {
    border-color: rgba(16, 185, 129, 0.3);
  }

  .progress-container.failed {
    border-color: rgba(233, 69, 96, 0.3);
  }
</style>
