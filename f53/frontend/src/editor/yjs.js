import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'

export class YjsCollaborativeEditor {
  constructor(docId, user) {
    this.docId = docId
    this.user = user
    this.ydoc = new Y.Doc()
    this.xmlFragment = this.ydoc.getXmlFragment('prosemirror')
    this.awareness = null
    this.wsProvider = null
    this.indexedDBProvider = null
    this.isConnected = false
  }

  init() {
    this.indexedDBProvider = new IndexeddbPersistence(`legal-doc-${this.docId}`, this.ydoc)
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/${this.docId}`
    
    this.wsProvider = new WebsocketProvider(
      wsUrl,
      this.docId,
      this.ydoc,
      { connect: true }
    )
    
    this.awareness = this.wsProvider.awareness
    
    if (this.user) {
      const colors = ['#f56c6c', '#67c23a', '#409eff', '#e6a23c', '#909399', '#06b6d4']
      const colorIndex = Math.abs(this.user.username.toString().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length
      
      this.awareness.setLocalStateField('user', {
        name: this.user.full_name || this.user.username,
        color: colors[colorIndex],
        role: this.user.role
      })
    }
    
    this.wsProvider.on('status', (event) => {
      this.isConnected = event.status === 'connected'
    })
    
    this.wsProvider.on('sync', (isSync) => {
      console.log('Sync status:', isSync)
    })
    
    return this
  }

  destroy() {
    if (this.wsProvider) {
      this.wsProvider.destroy()
    }
    if (this.indexedDBProvider) {
      this.indexedDBProvider.destroy()
    }
    this.ydoc.destroy()
  }

  getYDoc() {
    return this.ydoc
  }

  getXmlFragment() {
    return this.xmlFragment
  }

  getAwareness() {
    return this.awareness
  }
}

export function createCollaborativeEditor(docId, user) {
  const editor = new YjsCollaborativeEditor(docId, user)
  return editor.init()
}