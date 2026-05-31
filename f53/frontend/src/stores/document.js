import { defineStore } from 'pinia'
import axios from 'axios'

export const useDocumentStore = defineStore('document', {
  state: () => ({
    documents: [],
    currentDocument: null,
    comments: [],
    loading: false
  }),
  
  actions: {
    async fetchDocuments() {
      this.loading = true
      try {
        const response = await axios.get('/api/documents')
        this.documents = response.data
        return response.data
      } finally {
        this.loading = false
      }
    },
    
    async createDocument(title) {
      const response = await axios.post('/api/documents', { title })
      this.documents.unshift(response.data)
      return response.data
    },
    
    async getDocument(id) {
      const response = await axios.get(`/api/documents/${id}`)
      this.currentDocument = response.data
      return response.data
    },
    
    async fetchComments(docId) {
      const response = await axios.get(`/api/documents/${docId}/comments`)
      this.comments = response.data
      return response.data
    },
    
    async addComment(docId, content, position = null) {
      const response = await axios.post(`/api/documents/${docId}/comments`, {
        content,
        position
      })
      this.comments.unshift(response.data)
      return response.data
    }
  }
})