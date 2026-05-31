<template>
  <div class="heatmap-container">
    <div class="heatmap-toolbar">
      <div class="info">
        <span>最高: {{ maxRank?.toFixed(6) || 'N/A' }}</span>
        <span>最低: {{ minRank?.toFixed(6) || 'N/A' }}</span>
        <span>平均: {{ avgRank?.toFixed(6) || 'N/A' }}</span>
      </div>
      <div class="sort-control">
        <label>排序:</label>
        <select v-model="sortBy">
          <option value="rank">按PageRank</option>
          <option value="node">按节点ID</option>
        </select>
      </div>
    </div>
    <div ref="chartRef" class="chart"></div>
    <div class="rank-list">
      <h3>Top 20 节点</h3>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>节点</th>
              <th>PageRank</th>
              <th>占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in topNodes" :key="index">
              <td>{{ index + 1 }}</td>
              <td>{{ item.node }}</td>
              <td>{{ item.rank.toFixed(6) }}</td>
              <td>
                <div class="bar-container">
                  <div class="bar" :style="{ width: (item.rank / (maxRank || 1) * 100) + '%' }"></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'

const props = defineProps<{
  ranks: {[key: number]: number}
}>()

const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const sortBy = ref('rank')

const sortedRanks = computed(() => {
  const entries = Object.entries(props.ranks).map(([node, rank]) => ({
    node: parseInt(node),
    rank
  }))
  if (sortBy.value === 'rank') {
    entries.sort((a, b) => b.rank - a.rank)
  } else {
    entries.sort((a, b) => a.node - b.node)
  }
  return entries
})

const topNodes = computed(() => sortedRanks.value.slice(0, 20))

const maxRank = computed(() => {
  const ranks = Object.values(props.ranks)
  return ranks.length > 0 ? Math.max(...ranks) : 0
})

const minRank = computed(() => {
  const ranks = Object.values(props.ranks)
  return ranks.length > 0 ? Math.min(...ranks) : 0
})

const avgRank = computed(() => {
  const ranks = Object.values(props.ranks)
  if (ranks.length === 0) return 0
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
})

function getHeatmapColor(value: number, min: number, max: number): string {
  if (max === min) return '#3498db'
  const ratio = (value - min) / (max - min)
  const hue = 240 - ratio * 240
  return `hsl(${hue}, 80%, 50%)`
}

function renderChart() {
  if (!chartRef.value || Object.keys(props.ranks).length === 0) return

  const displayData = sortedRanks.value.slice(0, 100)
  const data = displayData.map((item, index) => ({
    value: item.rank,
    itemStyle: {
      color: getHeatmapColor(item.rank, minRank.value, maxRank.value)
    }
  }))

  const xLabels = displayData.map(item => item.node.toString())

  const option: echarts.EChartsOption = {
    tooltip: {
      formatter: (params: any) => {
        return `<strong>Node ${params.name}</strong><br/>PageRank: ${params.value.toFixed(6)}`
      }
    },
    grid: {
      left: 50,
      right: 20,
      top: 20,
      bottom: 80
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLabel: {
        rotate: 45,
        fontSize: 8,
        color: '#8892b0'
      },
      axisLine: {
        lineStyle: { color: '#2a2a4a' }
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#8892b0'
      },
      axisLine: {
        lineStyle: { color: '#2a2a4a' }
      },
      splitLine: {
        lineStyle: { color: '#2a2a4a', type: 'dashed' }
      }
    },
    series: [{
      type: 'bar',
      data: data,
      barWidth: '80%'
    }]
  }

  chart?.setOption(option)
}

function handleResize() {
  chart?.resize()
}

watch(() => [props.ranks, sortBy.value], () => {
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
.heatmap-container {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.heatmap-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.info {
  display: flex;
  gap: 15px;
  color: #8892b0;
}

.sort-control label {
  color: #8892b0;
  margin-right: 8px;
}

.sort-control select {
  background: #1a1a2e;
  color: #e0e0e0;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  padding: 4px 8px;
}

.chart {
  height: 250px;
  background: #1a1a2e;
  border-radius: 4px;
}

.rank-list h3 {
  font-size: 14px;
  color: #e94560;
  margin-bottom: 10px;
}

.table-wrapper {
  max-height: 300px;
  overflow-y: auto;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

thead {
  position: sticky;
  top: 0;
  background: #16213e;
  z-index: 1;
}

th, td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid #2a2a4a;
}

th {
  color: #8892b0;
  font-weight: 600;
}

td {
  color: #e0e0e0;
}

tbody tr:hover {
  background: #1a1a2e;
}

.bar-container {
  width: 100px;
  height: 8px;
  background: #2a2a4a;
  border-radius: 4px;
  overflow: hidden;
}

.bar {
  height: 100%;
  background: linear-gradient(90deg, #3498db, #e94560);
  border-radius: 4px;
  transition: width 0.3s ease;
}
</style>
