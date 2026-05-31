import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (email, password) =>
    api.post('/auth/register', { email, password }),
  login: (email, password, deviceFingerprint) => 
    api.post('/auth/login', { email, password, deviceFingerprint }),
  getProfile: () => api.get('/auth/me'),
};

export const policyApi = {
  getConditions: () => api.get('/policies/conditions'),
  getPolicies: () => api.get('/policies'),
  createPolicy: (data) => api.post('/policies', data),
  updatePolicy: (id, data) => api.put(`/policies/${id}`, data),
  deletePolicy: (id) => api.delete(`/policies/${id}`),
  setDefaultPolicy: (id) => api.post(`/policies/${id}/set-default`),
  initDefaultPolicies: () => api.post('/policies/init-default'),
  getDevices: () => api.get('/policies/devices'),
  setDeviceTrust: (fingerprint, trusted) => 
    api.put(`/policies/devices/${fingerprint}/trust`, { trusted }),
  setDeviceName: (fingerprint, name) => 
    api.put(`/policies/devices/${fingerprint}/name`, { name }),
  deleteDevice: (fingerprint) => 
    api.delete(`/policies/devices/${fingerprint}`),
  getAuthLogs: (limit = 50) => 
    api.get(`/policies/logs?limit=${limit}`),
};

export const webauthnApi = {
  getRegisterOptions: () => api.post('/webauthn/register/options'),
  verifyRegistration: (credential, deviceName) =>
    api.post('/webauthn/register/verify', { credential, deviceName }),
  getAuthOptions: (userId) => api.post('/webauthn/auth/options', { userId }),
  verifyAuthentication: (credential, userId) =>
    api.post('/webauthn/auth/verify', { credential, userId }),
  getCredentials: () => api.get('/webauthn/credentials'),
  deleteCredential: (credentialId) =>
    api.delete(`/webauthn/credentials/${credentialId}`),
};

export const totpApi = {
  setup: () => api.get('/totp/setup'),
  verifySetup: (secret, token) =>
    api.post('/totp/verify-setup', { secret, token }),
  disable: () => api.post('/totp/disable'),
  auth: (userId, token) => api.post('/totp/auth', { userId, token }),
};

export const backupApi = {
  generate: () => api.get('/backup/generate'),
  list: () => api.get('/backup/list'),
  disable: () => api.post('/backup/disable'),
  auth: (userId, code) => api.post('/backup/auth', { userId, code }),
};

export default api;
