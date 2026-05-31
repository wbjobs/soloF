<template>
  <div class="graph-container">
    <div class="graph-toolbar">
      <div class="view-mode">
        <label>显示模式:</label>
        <select v-model="viewMode">
          <option value="force">力导向图</option>
          <option value="circular">环形布局</option>
          <option value="hierarchical">层次布局</option>
        </select>
      </div>
      <div class="info">
        <span>节点: {{ nodes.length }}</span>
        <span>边: {{ edges.length }}</span>
      </div>
    </div>
    <div ref="chartRef" class="chart"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'

const props = defineProps<{
  nodes: number[]
  edges: {from: number, to: number}[]
  ranks: {[key: number]: number}
}>()

const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const viewMode = ref('force')

function getRankColor(rank: number, maxRank: number): string {
  if (maxRank === 0) return '#3498db'
  const ratio = rank / maxRank
  const r = Math.round(233 * ratio + 52 * (1 - ratio))
  const g = Math.round(69 * ratio + 152 * (1 - ratio))
  const b = Math.round(96 * ratio + 219 * (1 - ratio))
  return `rgb(${r}, ${g}, ${b})`
}

function getNodeSize(rank: number, maxRank: number, minRank: number): number {
  if (maxRank === minRank) return 15
  const ratio = (rank - minRank) / (maxRank - minRank)
  return 8 + ratio * 20
}

function renderChart() {
  if (!chartRef.value || props.nodes.length === 0) return

  const ranks = Object.values(props.ranks)
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0
  const minRank = ranks.length > 0 ? Math.min(...ranks) : 0

  const displayNodes = props.nodes.slice(0, 200)
  const displayNodeSet = new Set(displayNodes)
  const displayEdges = props.edges.filter(
    e => displayNodeSet.has(e.from) && displayNodeSet.has(e.to)
  ).slice(0, 500)

  const nodes = displayNodes.map(node => ({
    id: node.toString(),
    name: `Node ${node}`,
    symbolSize: getNodeSize(props.ranks[node] || 0, maxRank, minRank),
    itemStyle: {
      color: getRankColor(props.ranks[node] || 0, maxRank)
    },
    value: props.ranks[node] || 0
  }))

  const links = displayEdges.map(edge => ({
    source: edge.from.toString(),
    target: edge.to.toString(),
    lineStyle: {
      color: '#555',
      opacity: 0.4,
      curveness: 0.2
    }
  }))

  const option: echarts.EChartsOption = {
    tooltip: {
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          return `<strong>${params.data.name}</strong><br/>PageRank: ${(params.data.value || 0).toFixed(6)}`
        }
        return ''
      }
    },
    series: [{
      type: 'graph',
      layout: viewMode.value,
      data: nodes,
      links: links,
      roam: true,
      draggable: true,
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: [0, 6],
      lineStyle: {
        opacity: 0.4,
        width: 1
      },
      label: {
        show: nodes.length < 50,
        position: 'right',
        fontSize: 10
      },
      force: {
        repulsion: 100,
        edgeLength: [50, 150],
        gravity: 0.1
      },
      circular: {
        rotateLabel: true
      },
      emphasis: {
        focus: 'adjacency',
        lineStyle: {
          width: 3
        }
      }
    }]
  }

  chart?.setOption(option)
}

function handleResize() {
  chart?.resize()
}

watch(() => [props.nodes, props.edges, props.ranks, viewMode.value], () => {
  renderChart()
}, { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    renderChart()
    window.addEventListener('resize', handleResize)
  }
})

onUnmounted(() => {
  chart?.dispose()
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.graph-container {
  display: flex;
  flex-direction: column;
  height: 400px;
}

.graph-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 12px;
}

.view-mode label {
  color: #8892b0;
  margin-right: 8px;
}

.view-mode select {
  background: #1a1a2e;
  color: #e0e0e0;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  padding: 4px 8px;
}

.info {
  display: flex;
  gap: 15px;
  color: #8892b0;
}

.chart {
  flex: 1;
  background: #1a1a2e;
  border-radius: 4px;
  min-height: 350px;
}
</style>
