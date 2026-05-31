import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

export const taskAPI = {
  getTasks: () => api.get('/tasks'),
  getTask: (id) => api.get(`/tasks/${id}`),
  createTask: (data) => api.post('/tasks', data),
  updateTaskStatus: (id, status) => api.put(`/tasks/${id}/status`, { status }),
  deleteTask: (id) => api.delete(`/tasks/${id}`),
  getTaskExecutions: (id, limit = 20) => api.get(`/tasks/${id}/executions?limit=${limit}`),
  triggerTask: (id) => api.post(`/tasks/${id}/trigger`),
}

export default api
