<template>
  <div class="app-container">
    <header class="header">
      <h1>🍃 Celery 任务监控面板</h1>
      <div class="stats">
        <div class="stat-item">
          <span class="stat-label">总任务</span>
          <span class="stat-value">{{ stats.total }}</span>
        </div>
        <div class="stat-item pending">
          <span class="stat-label">等待中</span>
          <span class="stat-value">{{ stats.pending }}</span>
        </div>
        <div class="stat-item started">
          <span class="stat-label">执行中</span>
          <span class="stat-value">{{ stats.started }}</span>
        </div>
        <div class="stat-item success">
          <span class="stat-label">成功</span>
          <span class="stat-value">{{ stats.success }}</span>
        </div>
        <div class="stat-item failure">
          <span class="stat-label">失败</span>
          <span class="stat-value">{{ stats.failure }}</span>
        </div>
      </div>
      <div class="actions">
        <button @click="clearTasks" class="btn btn-danger">清除任务</button>
        <button @click="reconnect" class="btn btn-primary">{{ connected ? '已连接' : '重连' }}</button>
      </div>
    </header>

    <div class="main-content">
      <div class="graph-container">
        <svg ref="svgRef" class="graph-svg"></svg>
        <div v-if="selectedNode" class="tooltip" :style="tooltipStyle">
          <div class="tooltip-header">
            <span class="task-name">{{ selectedNode.name }}</span>
            <span class="task-status" :class="selectedNode.status.toLowerCase()">
              {{ selectedNode.status }}
            </span>
          </div>
          <div class="tooltip-body">
            <p><strong>ID:</strong> {{ selectedNode.id.slice(0, 20) }}...</p>
            <p><strong>进度:</strong> {{ selectedNode.progress }}%</p>
            <p v-if="selectedNode.result"><strong>结果:</strong> {{ JSON.stringify(selectedNode.result) }}</p>
            <p><strong>更新:</strong> {{ formatTime(selectedNode.updatedAt) }}</p>
          </div>
        </div>
      </div>

      <aside class="sidebar">
        <h3>任务列表</h3>
        <div class="task-list">
          <div
            v-for="node in sortedNodes"
            :key="node.id"
            class="task-item"
            :class="node.status.toLowerCase()"
            @click="highlightNode(node.id)"
          >
            <div class="task-item-header">
              <span class="task-dot" :class="node.status.toLowerCase()"></span>
              <span class="task-item-name">{{ node.name }}</span>
            </div>
            <div class="task-item-meta">
              <span class="task-progress">{{ node.progress }}%</span>
              <span class="task-time">{{ formatTime(node.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <div class="timeline-panel" v-if="timeTravelEnabled">
      <div class="timeline-header">
        <div class="timeline-title">
          <span class="time-travel-icon">⏰</span>
          <span>时间旅行</span>
        </div>
        <div class="timeline-controls">
          <button
            @click="toggleTimeTravel"
            class="btn btn-sm"
            :class="isLiveMode ? 'btn-primary' : 'btn-secondary'"
          >
            {{ isLiveMode ? '📡 实时模式' : '⏪ 历史模式' }}
          </button>
        </div>
      </div>

      <div v-if="!isLiveMode" class="timeline-content">
        <div class="timeline-playback">
          <button @click="skipToStart" class="btn btn-icon" :disabled="!hasSnapshots" title="跳到开始">
            ⏮️
          </button>
          <button @click="stepBackward" class="btn btn-icon" :disabled="!hasSnapshots || currentSnapshotIndex <= 0" title="上一帧">
            ◀️
          </button>
          <button
            @click="togglePlayback"
            class="btn btn-icon btn-play"
            :disabled="!hasSnapshots"
            :title="isPlaying ? '暂停' : '播放'"
          >
            {{ isPlaying ? '⏸️' : '▶️' }}
          </button>
          <button @click="stepForward" class="btn btn-icon" :disabled="!hasSnapshots || currentSnapshotIndex >= snapshots.length - 1" title="下一帧">
            ▶️
          </button>
          <button @click="skipToEnd" class="btn btn-icon" :disabled="!hasSnapshots" title="跳到结束">
            ⏭️
          </button>
          <select v-model="playbackSpeed" class="speed-select" title="播放速度">
            <option :value="0.5">0.5x</option>
            <option :value="1">1x</option>
            <option :value="2">2x</option>
            <option :value="4">4x</option>
          </select>
        </div>

        <div class="timeline-slider-container">
          <input
            type="range"
            :min="0"
            :max="snapshots.length - 1"
            v-model.number="currentSnapshotIndex"
            class="timeline-slider"
            :disabled="!hasSnapshots"
            @input="onSliderChange"
          />
          <div class="timeline-labels">
            <span>{{ formatTime(snapshots[0]?.timestamp || Date.now() - 3600000) }}</span>
            <span class="current-time">
              {{ currentSnapshot ? formatTime(currentSnapshot.timestamp) : '--:--:--' }}
            </span>
            <span>{{ formatTime(snapshots[snapshots.length - 1]?.timestamp || Date.now()) }}</span>
          </div>
        </div>

        <div class="timeline-info">
          <span v-if="hasSnapshots">
            快照: {{ currentSnapshotIndex + 1 }} / {{ snapshots.length }} |
            任务数: {{ currentSnapshot?.taskCount || 0 }}
          </span>
          <span v-else class="no-snapshots">
            暂无历史快照，请等待系统收集数据（每5秒保存一次）
          </span>
        </div>
      </div>

      <div v-else class="live-mode-indicator">
        <span class="live-dot"></span>
        <span>实时监控中</span>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item">
        <span class="legend-dot pending"></span>
        <span>PENDING (等待中)</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot started"></span>
        <span>STARTED (执行中)</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot success"></span>
        <span>SUCCESS (成功)</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot failure"></span>
        <span>FAILURE (失败)</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import * as d3 from 'd3';

const svgRef = ref(null);
const graphData = ref({ nodes: [], links: [] });
const selectedNode = ref(null);
const tooltipPosition = ref({ x: 0, y: 0 });
const connected = ref(false);
const eventSource = ref(null);

let simulation = null;
let svg = null;
let linkGroup = null;
let nodeGroup = null;
let labelGroup = null;
let nodeMap = new Map();
let linkMap = new Map();
let isDragging = false;
let updateTimer = null;
let playbackTimer = null;
let refreshTimer = null;
const UPDATE_DEBOUNCE_MS = 150;
const PLAYBACK_BASE_INTERVAL_MS = 200;

const SSE_URL = 'http://localhost:3001/events';
const API_BASE = 'http://localhost:3001/api';

const timeTravelEnabled = ref(true);
const isLiveMode = ref(true);
const snapshots = ref([]);
const currentSnapshotIndex = ref(0);
const isPlaying = ref(false);
const playbackSpeed = ref(1);
const liveGraphData = ref({ nodes: [], links: [] });

const statusColors = {
  PENDING: '#fbbf24',
  STARTED: '#3b82f6',
  SUCCESS: '#22c55e',
  FAILURE: '#ef4444',
  UNKNOWN: '#6b7280',
};

const hasSnapshots = computed(() => snapshots.value.length > 0);

const currentSnapshot = computed(() => {
  if (!hasSnapshots.value) return null;
  return snapshots.value[currentSnapshotIndex.value];
});

const effectiveGraphData = computed(() => {
  if (!isLiveMode.value && currentSnapshot.value) {
    return currentSnapshot.value.graphData;
  }
  return liveGraphData.value;
});

const stats = computed(() => {
  const nodes = effectiveGraphData.value.nodes;
  return {
    total: nodes.length,
    pending: nodes.filter(n => n.status === 'PENDING').length,
    started: nodes.filter(n => n.status === 'STARTED').length,
    success: nodes.filter(n => n.status === 'SUCCESS').length,
    failure: nodes.filter(n => n.status === 'FAILURE').length,
  };
});

const sortedNodes = computed(() => {
  return [...effectiveGraphData.value.nodes].sort((a, b) => b.updatedAt - a.updatedAt);
});

const tooltipStyle = computed(() => ({
  left: `${tooltipPosition.value.x + 15}px`,
  top: `${tooltipPosition.value.y + 15}px`,
}));

function connectSSE() {
  if (eventSource.value) {
    eventSource.value.close();
  }

  eventSource.value = new EventSource(SSE_URL);

  eventSource.value.onopen = () => {
    connected.value = true;
    console.log('SSE connected');
  };

  eventSource.value.onmessage = (event) => {
    try {
      liveGraphData.value = JSON.parse(event.data);
    } catch (err) {
      console.error('Error parsing SSE data:', err);
    }
  };

  eventSource.value.onerror = () => {
    connected.value = false;
    console.log('SSE error, reconnecting...');
  };
}

async function loadSnapshots() {
  try {
    const now = Date.now();
    const from = now - 60 * 60 * 1000;
    const response = await fetch(`${API_BASE}/snapshot/range?from=${from}&to=${now}&limit=200`);
    const data = await response.json();
    snapshots.value = data.snapshots || [];
    if (snapshots.value.length > 0) {
      currentSnapshotIndex.value = snapshots.value.length - 1;
    }
  } catch (err) {
    console.error('Error loading snapshots:', err);
  }
}

async function toggleTimeTravel() {
  if (isLiveMode.value) {
    await loadSnapshots();
    isLiveMode.value = false;
    nodeMap.clear();
    if (currentSnapshot.value) {
      graphData.value = currentSnapshot.value.graphData;
    }
  } else {
    stopPlayback();
    isLiveMode.value = true;
    nodeMap.clear();
    graphData.value = liveGraphData.value;
  }
}

function togglePlayback() {
  if (isPlaying.value) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (currentSnapshotIndex.value >= snapshots.value.length - 1) {
    currentSnapshotIndex.value = 0;
  }
  isPlaying.value = true;
  scheduleNextFrame();
}

function stopPlayback() {
  isPlaying.value = false;
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
}

function scheduleNextFrame() {
  if (!isPlaying.value) return;

  if (currentSnapshotIndex.value < snapshots.value.length - 1) {
    currentSnapshotIndex.value++;
    applyCurrentSnapshot();

    const interval = PLAYBACK_BASE_INTERVAL_MS / playbackSpeed.value;
    playbackTimer = setTimeout(scheduleNextFrame, interval);
  } else {
    stopPlayback();
  }
}

function stepForward() {
  if (currentSnapshotIndex.value < snapshots.value.length - 1) {
    currentSnapshotIndex.value++;
    applyCurrentSnapshot();
  }
}

function stepBackward() {
  if (currentSnapshotIndex.value > 0) {
    currentSnapshotIndex.value--;
    applyCurrentSnapshot();
  }
}

function skipToStart() {
  currentSnapshotIndex.value = 0;
  applyCurrentSnapshot();
}

function skipToEnd() {
  currentSnapshotIndex.value = snapshots.value.length - 1;
  applyCurrentSnapshot();
}

function onSliderChange() {
  applyCurrentSnapshot();
}

function applyCurrentSnapshot() {
  if (currentSnapshot.value) {
    nodeMap.clear();
    graphData.value = currentSnapshot.value.graphData;
  }
}

function reconnect() {
  connectSSE();
}

async function clearTasks() {
  try {
    await fetch('http://localhost:3001/api/tasks', { method: 'DELETE' });
  } catch (err) {
    console.error('Error clearing tasks:', err);
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function highlightNode(nodeId) {
  selectedNode.value = effectiveGraphData.value.nodes.find(n => n.id === nodeId);
  if (nodeGroup) {
    nodeGroup.selectAll('circle')
      .attr('stroke', d => d.id === nodeId ? '#fff' : 'transparent')
      .attr('stroke-width', d => d.id === nodeId ? 3 : 0)
      .attr('r', d => d.id === nodeId ? 25 : 20);
  }
}

function initGraph() {
  if (!svgRef.value) return;

  const container = svgRef.value.parentElement;
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height]);

  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 28)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('fill', '#475569');

  linkGroup = svg.append('g').attr('class', 'links');
  nodeGroup = svg.append('g').attr('class', 'nodes');
  labelGroup = svg.append('g').attr('class', 'labels');

  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(180).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-600))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(70).strength(0.8))
    .force('x', d3.forceX(width / 2).strength(0.05))
    .force('y', d3.forceY(height / 2).strength(0.05))
    .alphaDecay(0.03)
    .velocityDecay(0.4);

  const zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => {
      linkGroup.attr('transform', event.transform);
      nodeGroup.attr('transform', event.transform);
      labelGroup.attr('transform', event.transform);
    });

  svg.call(zoom);

  svg.on('click', (event) => {
    if (event.target === svgRef.value) {
      selectedNode.value = null;
      if (nodeGroup) {
        nodeGroup.selectAll('circle')
          .attr('stroke', 'transparent')
          .attr('stroke-width', 0)
          .attr('r', 20);
      }
    }
  });
}

function updateGraph() {
  if (!simulation || !graphData.value.nodes.length) return;

  const { nodes: newNodes, links: newLinks } = graphData.value;

  const mergedNodes = newNodes.map(n => {
    const existing = nodeMap.get(n.id);
    if (existing) {
      return {
        ...n,
        x: existing.x,
        y: existing.y,
        vx: existing.vx,
        vy: existing.vy,
        fx: existing.fx,
        fy: existing.fy,
      };
    }
    return n;
  });

  const nodeDataMap = new Map(mergedNodes.map(n => [n.id, n]));
  const mergedLinks = newLinks.map(l => ({
    ...l,
    source: nodeDataMap.get(typeof l.source === 'string' ? l.source : l.source.id) || l.source,
    target: nodeDataMap.get(typeof l.target === 'string' ? l.target : l.target.id) || l.target,
  }));

  mergedNodes.forEach(n => nodeMap.set(n.id, n));

  const link = linkGroup.selectAll('line')
    .data(mergedLinks, d => `${typeof d.source === 'object' ? d.source.id : d.source}-${typeof d.target === 'object' ? d.target.id : d.target}`);

  link.exit().remove();

  link.enter().append('line')
    .attr('stroke', '#475569')
    .attr('stroke-opacity', 0.6)
    .attr('stroke-width', 1.5)
    .attr('marker-end', 'url(#arrowhead)');

  const node = nodeGroup.selectAll('circle')
    .data(mergedNodes, d => d.id);

  node.exit().remove();

  const nodeEnter = node.enter().append('circle')
    .attr('r', 20)
    .attr('fill', d => statusColors[d.status] || statusColors.UNKNOWN)
    .attr('stroke', 'transparent')
    .attr('stroke-width', 0)
    .attr('cursor', 'grab')
    .call(d3.drag()
      .on('start', function(event, d) {
        isDragging = true;
        d3.select(this).attr('cursor', 'grabbing');
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function(event, d) {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function(event, d) {
        isDragging = false;
        d3.select(this).attr('cursor', 'grab');
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }))
    .on('click', (event, d) => {
      if (!isDragging) {
        event.stopPropagation();
        highlightNode(d.id);
      }
    })
    .on('mouseenter', (event, d) => {
      tooltipPosition.value = { x: event.offsetX, y: event.offsetY };
      selectedNode.value = d;
    })
    .on('mousemove', (event) => {
      tooltipPosition.value = { x: event.offsetX, y: event.offsetY };
    });

  node.merge(nodeEnter)
    .attr('cursor', d => d.fx !== undefined ? 'grabbing' : 'grab')
    .transition()
    .duration(300)
    .attr('fill', d => statusColors[d.status] || statusColors.UNKNOWN);

  const label = labelGroup.selectAll('text')
    .data(mergedNodes, d => d.id);

  label.exit().remove();

  label.enter().append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 35)
    .attr('fill', '#e2e8f0')
    .attr('font-size', '11px')
    .attr('pointer-events', 'none')
    .merge(label)
    .text(d => d.name);

  simulation.nodes(mergedNodes);
  simulation.force('link').links(mergedLinks);

  const hasNewNodes = newNodes.some(n => !nodeMap.has(n.id));
  if (hasNewNodes || newLinks.length !== linkMap.size) {
    simulation.alpha(0.3).restart();
  } else {
    simulation.alpha(0.1).restart();
  }

  linkMap = new Map(mergedLinks.map(l => [`${typeof l.source === 'object' ? l.source.id : l.source}-${typeof l.target === 'object' ? l.target.id : l.target}`, l]));

  simulation.on('tick', () => {
    linkGroup.selectAll('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeGroup.selectAll('circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    labelGroup.selectAll('text')
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });
}



watch(() => effectiveGraphData.value, () => {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    graphData.value = effectiveGraphData.value;
    nextTick(() => updateGraph());
  }, UPDATE_DEBOUNCE_MS);
}, { deep: true });

watch(isLiveMode, (live) => {
  if (live) {
    graphData.value = liveGraphData.value;
  } else if (currentSnapshot.value) {
    graphData.value = currentSnapshot.value.graphData;
  }
  nodeMap.clear();
  nextTick(() => updateGraph());
});

watch(currentSnapshot, (snapshot) => {
  if (!isLiveMode.value && snapshot) {
    nodeMap.clear();
    graphData.value = snapshot.graphData;
    nextTick(() => updateGraph());
  }
}, { deep: true });

onMounted(() => {
  initGraph();
  connectSSE();
  graphData.value = liveGraphData.value;

  refreshTimer = setInterval(() => {
    if (!isLiveMode.value) {
      loadSnapshots();
    }
  }, 30000);

  window.addEventListener('resize', () => {
    if (svgRef.value) {
      const container = svgRef.value.parentElement;
      const width = container.clientWidth;
      const height = container.clientHeight;
      svg.attr('width', width).attr('height', height);
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.alpha(0.3).restart();
    }
  });
});

onUnmounted(() => {
  if (eventSource.value) {
    eventSource.value.close();
  }
  if (simulation) {
    simulation.stop();
  }
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
  if (playbackTimer) {
    clearTimeout(playbackTimer);
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  flex-shrink: 0;
}

.header h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.stats {
  display: flex;
  gap: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 12px;
  border-radius: 8px;
  background: #334155;
  min-width: 70px;
}

.stat-label {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #f1f5f9;
}

.stat-item.pending .stat-value { color: #fbbf24; }
.stat-item.started .stat-value { color: #3b82f6; }
.stat-item.success .stat-value { color: #22c55e; }
.stat-item.failure .stat-value { color: #ef4444; }

.actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.graph-container {
  flex: 1;
  position: relative;
  background: #0f172a;
  overflow: hidden;
}

.graph-svg {
  width: 100%;
  height: 100%;
}

.tooltip {
  position: absolute;
  background: #1e293b;
  border: 1px solid #475569;
  border-radius: 8px;
  padding: 12px;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  min-width: 250px;
}

.tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #475569;
}

.task-name {
  font-weight: 600;
  font-size: 14px;
}

.task-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.task-status.pending { background: #fbbf24; color: #000; }
.task-status.started { background: #3b82f6; color: #fff; }
.task-status.success { background: #22c55e; color: #fff; }
.task-status.failure { background: #ef4444; color: #fff; }

.tooltip-body p {
  margin: 4px 0;
  font-size: 12px;
  color: #cbd5e1;
  word-break: break-all;
}

.tooltip-body strong {
  color: #f1f5f9;
}

.sidebar {
  width: 300px;
  background: #1e293b;
  border-left: 1px solid #334155;
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #f1f5f9;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  background: #334155;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.task-item:hover {
  background: #475569;
}

.task-item.pending { border-left-color: #fbbf24; }
.task-item.started { border-left-color: #3b82f6; }
.task-item.success { border-left-color: #22c55e; }
.task-item.failure { border-left-color: #ef4444; }

.task-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.task-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.task-dot.pending { background: #fbbf24; }
.task-dot.started { background: #3b82f6; animation: pulse 1.5s infinite; }
.task-dot.success { background: #22c55e; }
.task-dot.failure { background: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.task-item-name {
  font-size: 13px;
  font-weight: 500;
}

.task-item-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
}

.legend {
  display: flex;
  gap: 24px;
  padding: 10px 24px;
  background: #1e293b;
  border-top: 1px solid #334155;
  flex-shrink: 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #94a3b8;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-dot.pending { background: #fbbf24; }
.legend-dot.started { background: #3b82f6; }
.legend-dot.success { background: #22c55e; }
.legend-dot.failure { background: #ef4444; }

.timeline-panel {
  background: #1e293b;
  border-top: 1px solid #334155;
  padding: 12px 24px;
  flex-shrink: 0;
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.timeline-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #f1f5f9;
}

.time-travel-icon {
  font-size: 18px;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-secondary {
  background: #475569;
  color: white;
}

.btn-secondary:hover {
  background: #64748b;
}

.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline-playback {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon {
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: #334155;
  color: #f1f5f9;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover:not(:disabled) {
  background: #475569;
}

.btn-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-play {
  background: #22c55e;
  width: 44px;
  height: 44px;
  font-size: 18px;
}

.btn-play:hover:not(:disabled) {
  background: #16a34a;
}

.speed-select {
  margin-left: 8px;
  padding: 6px 10px;
  background: #334155;
  color: #f1f5f9;
  border: 1px solid #475569;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.speed-select:focus {
  outline: none;
  border-color: #3b82f6;
}

.timeline-slider-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-slider {
  width: 100%;
  height: 6px;
  background: #334155;
  border-radius: 3px;
  outline: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}

.timeline-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #2563eb;
}

.timeline-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
}

.current-time {
  font-weight: 600;
  color: #3b82f6;
}

.timeline-info {
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
}

.no-snapshots {
  color: #fbbf24;
}

.live-mode-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0;
  color: #22c55e;
  font-size: 13px;
}

.live-dot {
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
  animation: live-pulse 1.5s infinite;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
</style>
