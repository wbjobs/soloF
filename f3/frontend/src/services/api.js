import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const uploadPDF = async (file, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/api/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress) {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        onProgress(percentCompleted);
      }
    },
  });

  return response.data;
};

export const getTaskStatus = async (taskId) => {
  const response = await api.get(`/api/task/${taskId}`);
  return response.data;
};

export const getConversionResult = async (fileId) => {
  const response = await api.get(`/api/result/${fileId}`);
  return response.data;
};

export const updateMarkdown = async (fileId, markdown) => {
  const response = await api.put(`/api/result/${fileId}`, null, {
    params: { markdown },
  });
  return response.data;
};

export const getDownloadUrl = async (fileId) => {
  const response = await api.get(`/api/download/${fileId}`);
  return response.data;
};

export default api;
