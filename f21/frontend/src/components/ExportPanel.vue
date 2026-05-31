<template>
  <div class="export-panel">
    <div class="panel-header" @click="togglePanel">
      <h3>📥 数据导出</h3>
      <span class="toggle-icon">{{ isOpen ? '▼' : '▶' }}</span>
    </div>
    
    <div v-if="isOpen" class="panel-content">
      <div class="export-section">
        <h4>传感器数据导出</h4>
        <div class="export-controls">
          <div class="control-group">
            <label>时间范围</label>
            <select v-model="sensorHours" class="form-select">
              <option :value="1">最近 1 小时</option>
              <option :value="6">最近 6 小时</option>
              <option :value="12">最近 12 小时</option>
              <option :value="24">最近 24 小时</option>
              <option :value="72">最近 3 天</option>
              <option :value="168">最近 7 天</option>
            </select>
          </div>
          <button @click="handleExportSensorData" class="btn btn-export" :disabled="isExportingSensor">
            {{ isExportingSensor ? '导出中...' : '导出 CSV' }}
          </button>
        </div>
      </div>

      <div class="export-section">
        <h4>异常数据导出</h4>
        <div class="export-controls">
          <div class="control-group">
            <label>记录数量</label>
            <select v-model="anomalyLimit" class="form-select">
              <option :value="50">最近 50 条</option>
              <option :value="100">最近 100 条</option>
              <option :value="500">最近 500 条</option>
              <option :value="1000">最近 1000 条</option>
            </select>
          </div>
          <button @click="handleExportAnomalyData" class="btn btn-export" :disabled="isExportingAnomaly">
            {{ isExportingAnomaly ? '导出中...' : '导出 CSV' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { exportSensorData, exportAnomalies } from '../api'

const isOpen = ref(false)
const isExportingSensor = ref(false)
const isExportingAnomaly = ref(false)
const sensorHours = ref(24)
const anomalyLimit = ref(100)

const togglePanel = () => {
  isOpen.value = !isOpen.value
}

const handleExportSensorData = async () => {
  isExportingSensor.value = true
  try {
    await exportSensorData(sensorHours.value)
  } catch (error) {
    console.error('导出传感器数据失败:', error)
    alert('导出失败，请重试')
  } finally {
    isExportingSensor.value = false
  }
}

const handleExportAnomalyData = async () => {
  isExportingAnomaly.value = true
  try {
    await exportAnomalies(anomalyLimit.value)
  } catch (error) {
    console.error('导出异常数据失败:', error)
    alert('导出失败，请重试')
  } finally {
    isExportingAnomaly.value = false
  }
}
</script>

<style scoped>
.export-panel {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.panel-header {
  padding: 16px 20px;
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  color: white;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: opacity 0.2s;
}

.panel-header:hover {
  opacity: 0.95;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.toggle-icon {
  font-size: 12px;
  opacity: 0.8;
}

.panel-content {
  padding: 20px;
}

.export-section {
  margin-bottom: 20px;
}

.export-section:last-child {
  margin-bottom: 0;
}

.export-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.export-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-group label {
  font-size: 12px;
  font-weight: 500;
  color: #666;
}

.form-select {
  padding: 8px 32px 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.form-select:focus {
  outline: none;
  border-color: #11998e;
  box-shadow: 0 0 0 3px rgba(17, 153, 142, 0.1);
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-export {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  color: white;
}

.btn-export:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(17, 153, 142, 0.4);
}
</style>
