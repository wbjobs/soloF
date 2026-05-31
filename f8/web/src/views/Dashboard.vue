<template>
  <div class="dashboard">
    <h2>Dashboard</h2>
    
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon blue">
            <el-icon><DataLine /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ report?.total_blocks || 0 }}</div>
            <div class="stat-label">Total Blocks</div>
          </div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon green">
            <el-icon><TrendCharts /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ formatNumber(report?.total_series || 0) }}</div>
            <div class="stat-label">Total Series</div>
          </div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon orange">
            <el-icon><Warning /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ (report?.fragmentation?.fragmentation_rate * 100 || 0).toFixed(1) }}%</div>
            <div class="stat-label">Fragmentation Rate</div>
          </div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon purple">
            <el-icon><Timer /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ report?.estimated_query_delay_ms?.toFixed(2) || 0 }} ms</div>
            <div class="stat-label">Est. Query Delay</div>
          </div>
        </div>
      </el-card>
    </el-col>
  </el-row>

  <el-row :gutter="20">
    <el-col :span="12">
      <el-card class="chart-card">
        <template #header>
          <span>Fragmentation Overview</span>
        </template>
        <div ref="fragChart" class="chart"></div>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card class="chart-card">
        <template #header>
          <span>Block Statistics</span>
        </template>
        <div ref="blockChart" class="chart"></div>
      </el-card>
    </el-col>
  </el-row>

  <el-row :gutter="20" style="margin-top: 20px;">
    <el-col :span="24">
      <el-card>
        <template #header>
          <span>Recommendations</span>
          <el-button type="primary" @click="loadData" :loading="loading" style="float: right">
            <el-icon><Refresh /></el-icon> Refresh
          </el-button>
        </template>
        <el-alert
          v-for="(rec, index) in report?.recommendations || []"
          :key="index"
          :title="rec"
          type="info"
          :closable="false"
          style="margin-bottom: 10px"
        />
      </el-card>
    </el-col>
  </el-row>
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { DataLine, TrendCharts, Warning, Timer, Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const report = ref(null)
const loading = ref(false)
const fragChart = ref(null)
const blockChart = ref(null)
let fragChartInstance = ref(null)
let blockChartInstance = ref(null)

const formatNumber = (num) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/v1/analyze')
    report.value = res.data
    renderCharts()
  } catch (e) {
    console.error('Failed to load data:', e)
  } finally {
    loading.value = false
  }
}

const renderCharts = () => {
  if (!report.value) return

  if (fragChart.value) {
    fragChartInstance.value = echarts.init(fragChart.value)
    fragChartInstance.value.setOption({
      series: [{
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 100,
      splitNumber: 10,
      axisLine: {
        lineStyle: {
          width: 15,
          color: [
            [0.3, '#67C23A'],
            [0.7, '#E6A23C'],
            [1, '#F56C6C']
          ]
        }
      },
      pointer: {
        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
        length: '55%',
        width: 20
      },
      axisTick: {
        length: 12,
        lineStyle: {
          color: 'auto',
          width: 2
        }
      },
      splitLine: {
        length: 20,
        lineStyle: {
          color: 'auto',
          width: 5
        }
      },
      axisLabel: {
        color: '#464646',
        fontSize: 12,
        distance: -60,
        formatter: function (value) {
          if (value === 0) {
            return 'Good'
          } else if (value === 50) {
            return 'Medium'
          } else if (value === 100) {
            return 'Critical'
          }
          return ''
        }
      },
      title: {
        offsetCenter: [0, -20],
        fontSize: 20
      },
      detail: {
        fontSize: 30,
        offsetCenter: [0, -40],
        valueAnimation: true,
        formatter: '{value}%'
      },
      data: [{
        value: (report.value.fragmentation.fragmentation_rate * 100).toFixed(1),
        name: 'Fragmentation'
      }]
    }]
  })
  }

  if (blockChart.value && report.value.block_details) {
    blockChartInstance.value = echarts.init(blockChart.value)
    blockChartInstance.value.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        }
      },
      xAxis: {
        type: 'category',
        data: report.value.block_details.map(b => b.ulid.substring(0, 8)),
        axisLabel: {
          rotate: 45
        }
      },
      yAxis: {
        type: 'value',
        name: 'Series Count'
      },
      series: [{
        name: 'Series',
        type: 'bar',
        data: report.value.block_details.map(b => b.num_series),
        itemStyle: {
          color: '#409EFF'
        }
      }]
    })
  }
}

onMounted(() => {
  loadData()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (fragChartInstance.value?.dispose) fragChartInstance.value.dispose()
  if (blockChartInstance.value?.dispose) blockChartInstance.value.dispose()
})

const handleResize = () => {
  fragChartInstance.value?.resize()
  blockChartInstance.value?.resize()
}
</script>

<style scoped>
.dashboard h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  border-radius: 8px;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: white;
}

.stat-icon.blue { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.stat-icon.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.stat-icon.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.stat-icon.purple { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.chart-card {
  height: 350px;
}

.chart {
  width: 100%;
  height: 300px;
}
</style>
