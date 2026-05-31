import { io } from 'socket.io-client'
import { applyOperation, transform, OP_INSERT, OP_DELETE } from './ot.js'

export class CollabClient {
  constructor(docId, userId) {
    this.docId = docId
    this.userId = userId
    this.socket = null
    this.content = ''
    this.version = 0
    this.pendingOp = null
    this.localHistory = []
    this.remoteHistory = []
    this.listeners = new Map()
    this.isApplyingRemote = false
  }

  connect() {
    this.socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling']
    })

    this.socket.on('connect', () => {
      console.log('已连接到服务器')
      this.socket.emit('join-document', { docId: this.docId })
    })

    this.socket.on('document-joined', (data) => {
      this.content = data.content
      this.version = data.version
      this.emit('ready', data)
    })

    this.socket.on('operation', ({ op, version }) => {
      this.applyRemoteOperation(op)
      this.version = version
    })

    this.socket.on('operation-ack', ({ version, originalOp, transformedOp }) => {
      if (this.pendingOp && 
          originalOp.position === this.pendingOp.position &&
          originalOp.type === this.pendingOp.type &&
          originalOp.text === this.pendingOp.text &&
          originalOp.length === this.pendingOp.length) {
        this.pendingOp = null
        this.version = version
        this.remoteHistory.push(transformedOp)
        this.sendPending()
      }
    })

    this.socket.on('operation-rejected', ({ version, content }) => {
      this.content = content
      this.version = version
      this.pendingOp = null
      this.localHistory = []
      this.emit('content-reset', content)
    })

    this.socket.on('user-joined', (data) => {
      this.emit('user-joined', data)
    })

    this.socket.on('user-left', (data) => {
      this.emit('user-left', data)
    })

    this.socket.on('cursor-update', (data) => {
      this.emit('cursor-update', data)
    })

    this.socket.on('disconnect', () => {
      console.log('与服务器断开连接')
      this.emit('disconnect')
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach(cb => cb(data))
    }
  }

  applyRemoteOperation(remoteOp) {
    this.isApplyingRemote = true
    
    let opToApply = { ...remoteOp }
    
    if (this.pendingOp) {
      const [transformedPending, transformedRemote] = transform(this.pendingOp, opToApply)
      this.pendingOp = transformedPending
      opToApply = transformedRemote
    }
    
    const newLocalHistory = []
    for (const localOp of this.localHistory) {
      const [transformedLocal, transformedRemote] = transform(localOp, opToApply)
      newLocalHistory.push(transformedLocal)
      opToApply = transformedRemote
    }
    this.localHistory = newLocalHistory
    
    if (opToApply.type !== OP_DELETE || opToApply.length > 0) {
      this.content = applyOperation(this.content, opToApply)
      this.remoteHistory.push(opToApply)
      this.emit('remote-operation', opToApply)
    }
    
    this.isApplyingRemote = false
  }

  sendOperation(op) {
    if (this.isApplyingRemote) return

    if (!this.pendingOp) {
      this.pendingOp = op
      this.socket.emit('operation', {
        docId: this.docId,
        op,
        clientVersion: this.version
      })
    } else {
      this.localHistory.push(op)
    }
    
    this.content = applyOperation(this.content, op)
  }

  sendPending() {
    if (this.localHistory.length > 0 && !this.pendingOp) {
      const op = this.localHistory.shift()
      this.pendingOp = op
      this.socket.emit('operation', {
        docId: this.docId,
        op,
        clientVersion: this.version
      })
    }
  }

  sendCursorUpdate(cursor) {
    if (this.socket) {
      this.socket.emit('cursor-update', {
        docId: this.docId,
        cursor
      })
    }
  }

  getContent() {
    return this.content
  }

  getVersion() {
    return this.version
  }
}
