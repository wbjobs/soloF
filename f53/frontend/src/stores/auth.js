import { defineStore } from 'pinia'
import axios from 'axios'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null')
  }),
  
  getters: {
    isAuthenticated: (state) => !!state.token,
    userRole: (state) => state.user?.role || '',
    isLawyer: (state) => state.user?.role === 'lawyer' || state.user?.role === 'admin',
    canEdit: (state) => state.user?.role === 'lawyer' || state.user?.role === 'admin',
    canComment: (state) => !!state.user
  },
  
  actions: {
    async login(username, password) {
      const formData = new FormData()
      formData.append('username', username)
      formData.append('password', password)
      
      const response = await axios.post('/api/token', formData)
      this.token = response.data.access_token
      this.user = response.data.user
      
      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))
      
      axios.defaults.headers.common['Authorization'] = `Bearer ${this.token}`
      
      return response.data
    },
    
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      delete axios.defaults.headers.common['Authorization']
    },
    
    initAuth() {
      if (this.token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.token}`
      }
    }
  }
})