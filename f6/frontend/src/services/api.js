import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error)
    return Promise.reject(error)
  }
)

export const healthCheck = async () => {
  try {
    const response = await apiClient.get('/health')
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '健康检查失败')
  }
}

export const uploadAudio = async (audioBlob, fileName = 'recording.webm') => {
  try {
    const formData = new FormData()
    formData.append('audio', audioBlob, fileName)

    const response = await apiClient.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '音频上传失败')
  }
}

export const processAudio = async (audioId) => {
  try {
    const response = await apiClient.post('/process', { audioId })
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '音频处理失败')
  }
}

export const getAudioList = async () => {
  try {
    const response = await apiClient.get('/audio')
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '获取音频列表失败')
  }
}

export const getAudioById = async (audioId) => {
  try {
    const response = await apiClient.get(`/audio/${audioId}`)
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '获取音频信息失败')
  }
}

export const deleteAudio = async (audioId) => {
  try {
    const response = await apiClient.delete(`/audio/${audioId}`)
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '删除音频失败')
  }
}

export const downloadAudio = async (audioId) => {
  try {
    const response = await apiClient.get(`/audio/${audioId}/download`, {
      responseType: 'blob',
    })
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '下载音频失败')
  }
}

export const downloadMidiFromBackend = async (audioId) => {
  try {
    const response = await apiClient.get(`/audio/${audioId}/midi`, {
      responseType: 'blob',
    })
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '下载 MIDI 失败')
  }
}

export const generateMidi = async (midiData) => {
  try {
    const response = await apiClient.post('/midi/generate', midiData, {
      responseType: 'blob',
    })
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || '生成 MIDI 失败')
  }
}

export default {
  healthCheck,
  uploadAudio,
  processAudio,
  getAudioList,
  getAudioById,
  deleteAudio,
  downloadAudio,
  downloadMidiFromBackend,
  generateMidi,
}
