<template>
  <div class="app">
    <header class="header">
      <h1>🌾 农业物联网监控系统</h1>
      <div class="status" :class="{ connected: isConnected }">
        {{ isConnected ? '● 已连接' : '○ 未连接' }}
      </div>
    </header>

    <main class="main">
      <section class="stats-section">
        <div class="cards-grid">
          <DataCard
            v-for="sensor in sensors"
            :key="sensor.device_id + '-moisture'"
            title="土壤湿度"
            :value="sensor.soil_moisture"
            unit="%"
            icon="💧"
            :device-id="sensor.device_id"
            :timestamp="sensor.timestamp"
          />
          <DataCard
            v-for="sensor in sensors"
            :key="sensor.device_id + '-temp'"
            title="温度"
            :value="sensor.temperature"
            unit="°C"
            icon="🌡️"
            :device-id="sensor.device_id"
            :timestamp="sensor.timestamp"
          />
        </div>
        <div class="stats-summary">
          <div class="stat-item">
            <span class="stat-label">在线设备</span>
            <span class="stat-value">{{ sensors.length }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">异常记录</span>
            <span class="stat-value anomaly">{{ anomalies.length }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">最后更新</span>
            <span class="stat-value">{{ lastUpdate }}</span>
          </div>
        </div>
      </section>

      <section class="map-section">
        <div class="section-header">
          <h2>📍 传感器地理位置分布</h2>
        </div>
        <div class="map-wrapper">
          <SensorMap :sensors="sensors" />
        </div>
      </section>

      <section class="config-section">
        <div class="panels-grid">
          <ConfigPanel @config-updated="onConfigUpdated" />
          <ExportPanel />
        </div>
      </section>

      <section class="anomalies-section">
        <div class="section-header">
          <h2>⚠️ 异常数据记录</h2>
        </div>
        <div class="table-wrapper">
          <table v-if="anomalies.length > 0" class="anomalies-table">
            <thead>
              <tr>
                <th>设备ID</th>
                <th>时间</th>
                <th>传感器类型</th>
                <th>数值</th>
                <th>均值</th>
                <th>标准差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(anomaly, index) in anomalies" :key="index">
                <td>{{ anomaly.device_id }}</td>
                <td>{{ formatTime(anomaly.timestamp) }}</td>
                <td>{{ getSensorTypeName(anomaly.sensor_type) }}</td>
                <td class="value anomaly-value">{{ anomaly.value.toFixed(2) }}</td>
                <td>{{ anomaly.mean_value.toFixed(2) }}</td>
                <td>{{ anomaly.std_value.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="no-data">
            <p>暂无异常数据</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <p>农业物联网系统 - 实时监控仪表板</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import SensorMap from './components/SensorMap.vue'
import DataCard from './components/DataCard.vue'
import ConfigPanel from './components/ConfigPanel.vue'
import ExportPanel from './components/ExportPanel.vue'
import { getLatestSensors, getAnomalies, healthCheck } from './api'
import type { SensorData, AnomalyData, AnomalyConfig } from './types'

const sensors = ref<SensorData[]>([])
const anomalies = ref<AnomalyData[]>([])
const isConnected = ref(false)
const lastUpdate = ref('--')

let refreshInterval: number | null = null

const fetchData = async () => {
  try {
    isConnected.value = await healthCheck()
    if (isConnected.value) {
      sensors.value = await getLatestSensors()
      anomalies.value = await getAnomalies(50)
      lastUpdate.value = new Date().toLocaleString('zh-CN')
    }
  } catch (error) {
    console.error('获取数据失败:', error)
    isConnected.value = false
  }
}

const onConfigUpdated = (config: AnomalyConfig) => {
  console.log('配置已更新:', config)
}

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const getSensorTypeName = (type: string) => {
  const names: Record<string, string> = {
    soil_moisture: '土壤湿度',
    temperature: '温度'
  }
  return names[type] || type
}

onMounted(async () => {
  await fetchData()
  refreshInterval = window.setInterval(fetchData, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #f5f7fa;
  color: #333;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
}

.status {
  font-size: 14px;
  opacity: 0.9;
}

.status.connected {
  color: #a8e6cf;
}

.main {
  flex: 1;
  padding: 30px 40px;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}

.stats-section {
  margin-bottom: 30px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.stats-summary {
  display: flex;
  gap: 30px;
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #333;
}

.stat-value.anomaly {
  color: #f5576c;
}

.config-section {
  margin-bottom: 30px;
}

.panels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 20px;
}

.map-section,
.anomalies-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.section-header {
  margin-bottom: 20px;
}

.section-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.map-wrapper {
  height: 500px;
  border-radius: 8px;
  overflow: hidden;
}

.table-wrapper {
  overflow-x: auto;
}

.anomalies-table {
  width: 100%;
  border-collapse: collapse;
}

.anomalies-table th,
.anomalies-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.anomalies-table th {
  background: #f8f9fa;
  font-weight: 600;
  font-size: 13px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.anomalies-table td {
  font-size: 14px;
}

.anomalies-table tr:hover {
  background: #f8f9fa;
}

.value {
  font-weight: 600;
}

.anomaly-value {
  color: #f5576c;
}

.no-data {
  text-align: center;
  padding: 40px;
  color: #999;
}

.footer {
  background: #fff;
  padding: 20px;
  text-align: center;
  color: #999;
  font-size: 14px;
  border-top: 1px solid #eee;
}

@media (max-width: 768px) {
  .header {
    padding: 16px 20px;
    flex-direction: column;
    gap: 10px;
  }

  .main {
    padding: 20px;
  }

  .stats-summary {
    flex-direction: column;
    gap: 15px;
  }

  .map-wrapper {
    height: 350px;
  }
}
</style>
