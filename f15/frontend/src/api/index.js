import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
})

export const workflowApi = {
  list: () => api.get('/workflows'),
  get: (id) => api.get(`/workflows/${id}`),
  create: (data) => api.post('/workflows', data),
  update: (id, data) => api.put(`/workflows/${id}`, data),
  delete: (id) => api.delete(`/workflows/${id}`),
  execute: (workflowId) => api.post('/execute', { workflow_id: workflowId })
}

export const executionApi = {
  list: () => api.get('/executions'),
  get: (id) => api.get(`/executions/${id}`),
  getTasks: (id) => api.get(`/executions/${id}/tasks`),
  getState: (id) => api.get(`/executions/${id}/state`),
  poll: (id) => api.post(`/executions/${id}/poll`)
}

export const taskApi = {
  getStatus: (taskId) => api.get(`/tasks/${taskId}/status`)
}

export const healthApi = {
  check: () => api.get('/health')
}

export default api