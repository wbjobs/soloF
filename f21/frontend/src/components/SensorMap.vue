<template>
  <div class="map-container">
    <div ref="mapElement" class="map"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { SensorData } from '../types'
import L from 'leaflet'

const props = defineProps<{
  sensors: SensorData[]
}>()

const mapElement = ref<HTMLElement | null>(null)
const map = ref<L.Map | null>(null)
const markers = ref<L.Marker[]>([])

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const initMap = () => {
  if (!mapElement.value || map.value) return

  map.value = L.map(mapElement.value).setView([39.9042, 116.4074], 12)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map.value)
}

const updateMarkers = () => {
  if (!map.value) return

  markers.value.forEach(marker => {
    marker.remove()
  })
  markers.value = []

  props.sensors.forEach(sensor => {
    const marker = L.marker([sensor.latitude, sensor.longitude])
    const popupContent = `
      <div class="tooltip-content">
        <h4>${sensor.device_id}</h4>
        <p>土壤湿度: ${sensor.soil_moisture.toFixed(1)}%</p>
        <p>温度: ${sensor.temperature.toFixed(1)}°C</p>
        <p class="time">${formatTime(sensor.timestamp)}</p>
      </div>
    `
    marker.bindPopup(popupContent)
    marker.addTo(map.value!)
    markers.value.push(marker)
  })

  if (props.sensors.length > 0) {
    const firstSensor = props.sensors[0]
    map.value.setView([firstSensor.latitude, firstSensor.longitude], 12)
  }
}

watch(() => props.sensors, () => {
  nextTick(() => {
    updateMarkers()
  })
}, { deep: true })

onMounted(() => {
  nextTick(() => {
    initMap()
    setTimeout(() => {
      updateMarkers()
    }, 100)
  })
})

onUnmounted(() => {
  if (map.value) {
    map.value.remove()
    map.value = null
  }
})
</script>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.map {
  width: 100%;
  height: 100%;
}

.tooltip-content h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #333;
}

.tooltip-content p {
  margin: 4px 0;
  font-size: 12px;
  color: #666;
}

.tooltip-content .time {
  margin-top: 8px;
  font-size: 11px;
  color: #999;
}
</style>
