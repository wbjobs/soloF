import axios from 'axios'
import type { SensorData, AnomalyData, AnomalyConfig } from './types'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
})

export const getLatestSensors = async (): Promise<SensorData[]> => {
  const response = await api.get('/sensors/latest')
  return response.data
}

export const getAnomalies = async (limit = 100): Promise<AnomalyData[]> => {
  const response = await api.get('/anomalies', { params: { limit } })
  return response.data
}

export const healthCheck = async (): Promise<boolean> => {
  try {
    await api.get('/health')
    return true
  } catch {
    return false
  }
}

export const getAnomalyConfig = async (): Promise<AnomalyConfig> => {
  const response = await api.get('/anomaly/config')
  return response.data
}

export const updateAnomalyConfig = async (config: Partial<AnomalyConfig>): Promise<AnomalyConfig> => {
  const response = await api.put('/anomaly/config', config)
  return response.data.config
}

export const exportSensorData = async (hours: number = 24): Promise<void> => {
  const response = await api.get('/sensors/export', {
    params: { hours },
    responseType: 'blob'
  })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `sensor_data_${hours}h.csv`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export const exportAnomalies = async (limit: number = 1000): Promise<void> => {
  const response = await api.get('/anomalies/export', {
    params: { limit },
    responseType: 'blob'
  })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `anomalies_${limit}.csv`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
