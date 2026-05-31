<template>
  <div class="app-container">
    <header class="app-header">
      <h1>PageRank 计算服务</h1>
      <div class="status-bar">
        <span :class="status-class">{{ status-text }}</span>
        <span class="iteration">迭代: {{ iteration }}</span>
        <span class="convergence">收敛: {{ converged ? '是' : '否' }}</span>
        <span class="workers">Worker: {{ ready-workers }} / {{ total-workers }}</span>
        <span class="failed-workers" v-if="failed-workers > 0">
          失败: {{ failed-workers }}
        </span>
        <span class="pending" v-if="pending-partitions > 0">
          待重分配: {{ pending-partitions }}
        </span>
      </div>
    </header>

    <main class="app-main">
      <div class="left-panel">
        <div class="panel-section">
          <h2>图数据输入</h2>
          <div class="input-group">
            <label>节点数量</label>
            <input type="number" v-model="graph-config.nodes" placeholder="1000" min="1" />
          </div>
          <div class="input-group">
            <label>边数量</label>
            <input type="number" v-model="graph-config.edges" placeholder="5000" min="1" />
          </div>
          <button class="btn btn-primary" @click="generate-graph">生成随机图</button>
          <button class="btn btn-secondary" @click="upload-graph">上传图数据</button>
        </div>

        <div class="panel-section">
          <h2>计算配置</h2>
          <div class="input-group">
            <label>阻尼因子 (Damping Factor)</label>
            <input type="number" v-model="config.damping-factor" step="0.01" min="0.1" max="0.99" />
          </div>
          <div class="input-group">
            <label>收敛阈值</label>
            <input type="number" v-model="config.convergence-threshold" step="0.0001" min="0.00001" />
          </div>
          <div class="input-group">
            <label>最大迭代次数</label>
            <input type="number" v-model="config.max-iterations" min="1" max="10000" />
          </div>
          <button class="btn btn-success" @click="startComputation" :disabled="!graphLoaded">
            开始计算
          </button>
          <button class="btn btn-danger" @click="stopComputation">
            停止计算
          </button>
        </div>

        <div class="panel-section">
          <h2>增量计算</h2>
          <div class="incremental-status">
            <span :class="'incremental-badge ' + (incrementalMode ? 'active' : 'inactive')">
              增量模式: {{ incrementalMode ? '开启' : '关闭' }}
            </span>
            <span class="pending-changes" v-if="pendingChanges > 0">
              待处理变更: {{ pendingChanges }}
            </span>
            <span class="affected-nodes" v-if="affectedCount > 0">
              受影响节点: {{ affectedCount }}
            </span>
          </div>

          <div class="input-group">
            <label>传播层级</label>
            <input type="number" v-model="incrementalConfig.propagationLevel" min="1" max="10" />
          </div>

          <div class="edge-operations">
            <h3>边操作</h3>
            <div class="input-row">
              <input type="number" v-model="edgeForm.from" placeholder="From节点" />
              <span class="arrow">→</span>
              <input type="number" v-model="edgeForm.to" placeholder="To节点" />
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" @click="addEdge">添加边</button>
              <button class="btn btn-danger" @click="removeEdge">删除边</button>
            </div>
          </div>

          <div class="batch-operations">
            <h3>批量操作</h3>
            <textarea v-model="batchEdgesText" placeholder="每行一条边，格式: from,to&#10;例如:&#10;1,2&#10;3,4" rows="4"></textarea>
            <div class="btn-row">
              <button class="btn btn-primary" @click="batchAddEdges">批量添加</button>
              <button class="btn btn-danger" @click="batchRemoveEdges">批量删除</button>
            </div>
          </div>

          <button class="btn btn-success incremental-btn" @click="startIncremental" :disabled="pendingChanges === 0">
            开始增量计算
          </button>

          <div class="incremental-config">
            <button class="btn btn-secondary" @click="applyIncrementalConfig">
              应用配置
            </button>
            <button class="btn btn-secondary" @click="fetchPendingChanges">
              刷新状态
            </button>
          </div>

          <div class="affected-list" v-if="affectedNodes.length > 0">
            <h4>受影响节点 (前20个):</h4>
            <div class="nodes-preview">
              <span v-for="node in affectedNodes.slice(0, 20)" :key="node" class="node-tag">
                {{ node }}
              </span>
              <span v-if="affectedNodes.length > 20" class="more-tag">
                +{{ affectedNodes.length - 20 }} 更多
              </span>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h2>Worker 状态</h2>
          <div class="worker-list">
            <div v-for="(status, id) in worker-status" :key="id" class="worker-item" :class="'state-' + status['state']">
              <div class="worker-id">
                {{ id }}
                <span class="state-badge">{{ getStateText(status['state']) }}</span>
              </div>
              <div class="worker-info">
                <span>分区: {{ status['partition_id'] }}</span>
                <span>最大Δ: {{ status['max_delta']?.toFixed(6) || 'N/A' }}</span>
                <span>收敛: {{ status['converged'] ? '是' : '否' }}</span>
                <span v-if="status['heartbeat_age_seconds']">
                  心跳: {{ status['heartbeat_age_seconds'].toFixed(1) }}s
                </span>
              </div>
              <div v-if="status['state'] === 'failed'" class="worker-error">
                失败时间: {{ status['failed_at'] }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="right-panel">
        <div class="panel-section">
          <h2>图结构可视化</h2>
          <GraphView :nodes="graph-nodes" :edges="graph-edges" :ranks="ranks" />
        </div>
        <div class="panel-section">
          <h2>PageRank 热力图</h2>
          <HeatMap :ranks="ranks" />
        </div>
      </div>
    </main>

    <footer class="app-footer">
      <span>PageRank Master-Worker 分布式计算系统</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import GraphView from './components/GraphView.vue'
import HeatMap from './components/HeatMap.vue'

const graphConfig = reactive({
  nodes: 1000,
  edges: 5000
})

const config = reactive({
  dampingFactor: 0.85,
  convergenceThreshold: 0.0001,
  maxIterations: 100
})

const graphNodes = ref<number[]>([])
const graphEdges = ref<{from: number, to: number}[]>([])
const ranks = ref<{[key: number]: number}>({})
const iteration = ref(0)
const converged = ref(false)
const readyWorkers = ref(0)
const totalWorkers = ref(3)
const maxDelta = ref(0)
const workerStatus = ref<{[key: string]: any}>({})
const graphLoaded = ref(false)
const failedWorkers = ref(0)
const pendingPartitions = ref(0)
const healthStatus = ref('healthy')
const incrementalMode = ref(false)
const pendingChanges = ref(0)
const affectedCount = ref(0)
const affectedNodes = ref<number[]>([])
const incrementalIteration = ref(0)

const incrementalConfig = reactive({
  propagationLevel: 3
})

const edgeForm = reactive({
  from: 0,
  to: 0
})

const batchEdgesText = ref('')

const statusText = computed(() => {
  if (healthStatus.value === 'degraded') return '服务降级'
  if (healthStatus.value === 'warning') return '重分配中'
  if (converged.value) return '已收敛'
  if (iteration.value > 0) return '计算中'
  if (graphLoaded.value) return '就绪'
  return '等待数据'
})

const statusClass = computed(() => {
  if (healthStatus.value === 'degraded') return 'status-failed'
  if (healthStatus.value === 'warning') return 'status-warning'
  if (converged.value) return 'status-converged'
  if (iteration.value > 0) return 'status-computing'
  return 'status-idle'
})

function getStateText(state: string): string {
  const map: {[key: string]: string} = {
    'idle': '空闲',
    'working': '工作中',
    'failed': '失败',
    'stalled': '停滞'
  }
  return map[state] || state
}

let pollingInterval: number | null = null

async function fetchStatus() {
  try {
    const res = await axios.get('/api/status')
    if (res.data) {
      iteration.value = res.data.iteration || 0
      converged.value = res.data.converged || false
      readyWorkers.value = res.data.ready_workers || 0
      totalWorkers.value = res.data.total_workers || 3
      maxDelta.value = res.data.max_delta || 0
      failedWorkers.value = res.data.failed_workers || 0
      pendingPartitions.value = res.data.pending_partitions || 0

      if (failedWorkers.value > 0) {
        healthStatus.value = 'degraded'
      } else if (pendingPartitions.value > 0) {
        healthStatus.value = 'warning'
      } else {
        healthStatus.value = 'healthy'
      }
    }
  } catch (e) {
    console.error('Failed to fetch status:', e)
    healthStatus.value = 'error'
  }
}

async function fetchResult() {
  try {
    const res = await axios.get('/api/result')
    if (res.data) {
      ranks.value = res.data.ranks || {}
      workerStatus.value = res.data.worker_status || {}
    }
  } catch (e) {
    console.error('Failed to fetch result:', e)
  }
}

async function fetchWorkers() {
  try {
    const res = await axios.get('/api/workers')
    if (res.data) {
      workerStatus.value = res.data.status || {}
    }
  } catch (e) {
    console.error('Failed to fetch workers:', e)
  }
}

async function generateGraph() {
  try {
    const res = await axios.post('/api/generate', null, {
      params: {
        nodes: graphConfig.nodes,
        edges: graphConfig.edges
      }
    })
    if (res.data) {
      graphNodes.value = res.data.nodes || []
      graphEdges.value = res.data.edges || []
      graphLoaded.value = true
    }
  } catch (e) {
    console.error('Failed to generate graph:', e)
  }
}

async function uploadGraph() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.txt'
  input.onchange = async (e: any) => {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    try {
      const data = JSON.parse(text)
      graphNodes.value = data.nodes || []
      graphEdges.value = data.edges || []
      await axios.post('/api/graph', data)
      graphLoaded.value = true
    } catch (e) {
      console.error('Failed to upload graph:', e)
    }
  }
  input.click()
}

async function startComputation() {
  try {
    await axios.post('/api/config', {
      damping_factor: config.dampingFactor,
      convergence_threshold: config.convergenceThreshold,
      max_iterations: config.maxIterations
    })
    await axios.post('/api/start')
  } catch (e) {
    console.error('Failed to start computation:', e)
  }
}

async function stopComputation() {
  try {
    await axios.post('/api/stop')
  } catch (e) {
    console.error('Failed to stop computation:', e)
  }
}

async function addEdge() {
  if (edgeForm.from === 0 || edgeForm.to === 0) {
    alert('请输入有效的节点ID')
    return
  }
  try {
    await axios.post('/api/incremental/edges/add', {
      from: edgeForm.from,
      to: edgeForm.to
    })
    alert(`边 ${edgeForm.from} → ${edgeForm.to} 添加成功`)
    graphEdges.value.push({ from: edgeForm.from, to: edgeForm.to })
    await fetchPendingChanges()
  } catch (e: any) {
    alert('添加失败: ' + (e.response?.data?.error || e.message))
  }
}

async function removeEdge() {
  if (edgeForm.from === 0 || edgeForm.to === 0) {
    alert('请输入有效的节点ID')
    return
  }
  try {
    await axios.post('/api/incremental/edges/remove', {
      from: edgeForm.from,
      to: edgeForm.to
    })
    alert(`边 ${edgeForm.from} → ${edgeForm.to} 删除成功`)
    graphEdges.value = graphEdges.value.filter(
      e => !(e.from === edgeForm.from && e.to === edgeForm.to)
    )
    await fetchPendingChanges()
  } catch (e: any) {
    alert('删除失败: ' + (e.response?.data?.error || e.message))
  }
}

function parseBatchEdges(): {from: number, to: number}[] {
  const lines = batchEdgesText.value.trim().split('\n')
  const edges: {from: number, to: number}[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(/[, \t]/).filter(p => p.trim())
    if (parts.length >= 2) {
      const from = parseInt(parts[0])
      const to = parseInt(parts[1])
      if (!isNaN(from) && !isNaN(to)) {
        edges.push({ from, to })
      }
    }
  }
  return edges
}

async function batchAddEdges() {
  const edges = parseBatchEdges()
  if (edges.length === 0) {
    alert('请输入有效的边数据')
    return
  }
  try {
    const res = await axios.post('/api/incremental/edges/batch-add', { edges })
    alert(`批量添加完成: ${res.data.added_count} / ${edges.length} 条边`)
    for (const edge of edges) {
      const exists = graphEdges.value.some(e => e.from === edge.from && e.to === edge.to)
      if (!exists) {
        graphEdges.value.push(edge)
      }
    }
    batchEdgesText.value = ''
    await fetchPendingChanges()
  } catch (e: any) {
    alert('批量添加失败: ' + (e.response?.data?.error || e.message))
  }
}

async function batchRemoveEdges() {
  const edges = parseBatchEdges()
  if (edges.length === 0) {
    alert('请输入有效的边数据')
    return
  }
  try {
    const res = await axios.post('/api/incremental/edges/batch-remove', { edges })
    alert(`批量删除完成: ${res.data.removed_count} / ${edges.length} 条边`)
    const removeSet = new Set(edges.map(e => `${e.from}-${e.to}`))
    graphEdges.value = graphEdges.value.filter(
      e => !removeSet.has(`${e.from}-${e.to}`)
    )
    batchEdgesText.value = ''
    await fetchPendingChanges()
  } catch (e: any) {
    alert('批量删除失败: ' + (e.response?.data?.error || e.message))
  }
}

async function startIncremental() {
  try {
    const res = await axios.post('/api/incremental/compute')
    alert(`增量计算已启动，受影响节点: ${res.data.affected_nodes}`)
  } catch (e: any) {
    alert('启动失败: ' + (e.response?.data?.error || e.message))
  }
}

async function applyIncrementalConfig() {
  try {
    await axios.post('/api/incremental/config', {
      max_propagation_level: incrementalConfig.propagationLevel,
      incremental_mode: true
    })
    alert('增量配置已应用')
    incrementalMode.value = true
  } catch (e: any) {
    alert('配置失败: ' + (e.response?.data?.error || e.message))
  }
}

async function fetchPendingChanges() {
  try {
    const res = await axios.get('/api/incremental/changes')
    if (res.data) {
      pendingChanges.value = res.data.pending_changes || 0
      affectedCount.value = res.data.affected_count || 0
      affectedNodes.value = res.data.affected_nodes || []
      incrementalMode.value = res.data.incremental_mode || false
      if (res.data.propagation_level) {
        incrementalConfig.propagationLevel = res.data.propagation_level
      }
    }
  } catch (e) {
    console.error('Failed to fetch pending changes:', e)
  }
}

function startPolling() {
  pollingInterval = window.setInterval(() => {
    fetchStatus()
    fetchResult()
    fetchWorkers()
    fetchPendingChanges()
  }, 1000)
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

onMounted(() => {
  fetchStatus()
  fetchWorkers()
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: linear-gradient(135deg, #16213e, #0f3460);
  padding: 20px 30px;
  border-bottom: 1px solid #2a2a4a;
}

.app-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 10px;
  color: #e94560;
}

.status-bar {
  display: flex;
  gap: 20px;
  font-size: 14px;
}

.status-bar span {
  padding: 4px 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
}

.status-converged { background: #27ae60 !important; }
.status-computing { background: #f39c12 !important; }
.status-idle { background: #3498db !important; }
.status-failed { background: #e74c3c !important; }
.status-warning { background: #f1c40f !important; color: #1a1a2e !important; }

.failed-workers { background: #e74c3c !important; }
.pending { background: #f1c40f !important; color: #1a1a2e !important; }

.app-main {
  flex: 1;
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 20px;
  padding: 20px;
}

.panel-section {
  background: #16213e;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  border: 1px solid #2a2a4a;
}

.panel-section h2 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 15px;
  color: #e94560;
}

.input-group {
  margin-bottom: 12px;
}

.input-group label {
  display: block;
  font-size: 12px;
  color: #8892b0;
  margin-bottom: 4px;
}

.input-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  background: #1a1a2e;
  color: #e0e0e0;
  font-size: 14px;
}

.input-group input:focus {
  outline: none;
  border-color: #e94560;
}

.btn {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary { background: #3498db; color: white; }
.btn-primary:hover:not(:disabled) { background: #2980b9; }

.btn-secondary { background: #95a5a6; color: white; }
.btn-secondary:hover:not(:disabled) { background: #7f8c8d; }

.btn-success { background: #27ae60; color: white; }
.btn-success:hover:not(:disabled) { background: #219a52; }

.btn-danger { background: #e74c3c; color: white; }
.btn-danger:hover:not(:disabled) { background: #c0392b; }

.worker-list {
  max-height: 200px;
  overflow-y: auto;
}

.worker-item {
  background: #1a1a2e;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 8px;
}

.worker-id {
  font-weight: 600;
  color: #e94560;
  margin-bottom: 4px;
}

.worker-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8892b0;
}

.worker-item.state-working {
  border-left: 3px solid #27ae60;
}

.worker-item.state-idle {
  border-left: 3px solid #3498db;
}

.worker-item.state-failed {
  border-left: 3px solid #e74c3c;
  background: #2c1320;
}

.state-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 8px;
  font-weight: normal;
}

.state-working .state-badge {
  background: #27ae60;
}

.state-idle .state-badge {
  background: #3498db;
}

.state-failed .state-badge {
  background: #e74c3c;
}

.worker-error {
  margin-top: 6px;
  font-size: 11px;
  color: #e74c3c;
}

.incremental-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.incremental-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.incremental-badge.active {
  background: #27ae60;
  color: white;
}

.incremental-badge.inactive {
  background: #7f8c8d;
  color: white;
}

.pending-changes {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  background: #f39c12;
  color: white;
  font-weight: 500;
}

.affected-nodes {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  background: #3498db;
  color: white;
  font-weight: 500;
}

.edge-operations, .batch-operations {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #2a2a4a;
}

.edge-operations h3, .batch-operations h3 {
  font-size: 14px;
  color: #e94560;
  margin-bottom: 8px;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.input-row input {
  flex: 1;
  min-width: 0;
}

.arrow {
  color: #e94560;
  font-weight: bold;
}

.btn-row {
  display: flex;
  gap: 8px;
}

.btn-row .btn {
  flex: 1;
  margin-bottom: 0;
}

.incremental-btn {
  margin-top: 12px;
  font-size: 15px;
  padding: 12px;
}

.incremental-config {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.incremental-config .btn {
  flex: 1;
  margin-bottom: 0;
}

.affected-list {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #2a2a4a;
}

.affected-list h4 {
  font-size: 13px;
  color: #8892b0;
  margin-bottom: 8px;
}

.nodes-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.node-tag {
  padding: 2px 8px;
  background: #2a2a4a;
  border-radius: 4px;
  font-size: 11px;
  color: #3498db;
}

.more-tag {
  padding: 2px 8px;
  background: #1a1a2e;
  border-radius: 4px;
  font-size: 11px;
  color: #8892b0;
}

.app-footer {
  background: #16213e;
  padding: 10px 30px;
  text-align: center;
  font-size: 12px;
  color: #8892b0;
  border-top: 1px solid #2a2a4a;
}

@media (max-width: 1024px) {
  .app-main {
    grid-template-columns: 1fr;
  }
}
</style>
