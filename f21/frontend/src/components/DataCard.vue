<template>
  <div class="data-card" :class="{ anomaly: isAnomaly }">
    <div class="card-header">
      <div class="card-icon">{{ icon }}</div>
      <div class="card-title">{{ title }}</div>
    </div>
    <div class="card-body">
      <div class="main-value">{{ value.toFixed(1) }}<span class="unit">{{ unit }}</span></div>
      <div class="sub-info">
        <span v-if="deviceId">设备: {{ deviceId }}</span>
        <span v-if="timestamp">更新: {{ formatTime(timestamp) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  value: number
  unit: string
  icon: string
  deviceId?: string
  timestamp?: string
  isAnomaly?: boolean
}>()

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleTimeString('zh-CN')
}
</script>

<style scoped>
.data-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px;
  color: white;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}

.data-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.data-card.anomaly {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  box-shadow: 0 4px 15px rgba(245, 87, 108, 0.3);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.card-icon {
  font-size: 28px;
}

.card-title {
  font-size: 16px;
  font-weight: 500;
  opacity: 0.9;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.main-value {
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
}

.main-value .unit {
  font-size: 18px;
  font-weight: 400;
  opacity: 0.8;
  margin-left: 4px;
}

.sub-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  opacity: 0.8;
}
</style>
