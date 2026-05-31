export interface SensorData {
  device_id: string
  timestamp: string
  latitude: number
  longitude: number
  soil_moisture: number
  temperature: number
}

export interface AnomalyData {
  device_id: string
  timestamp: string
  latitude: number
  longitude: number
  sensor_type: string
  value: number
  mean_value: number
  std_value: number
}

export interface AnomalyConfig {
  window_size: number
  iqr_threshold: number
  min_data_points: number
  recent_window: number
  required_anomalies: number
}
