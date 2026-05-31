class WebSocketManager {
  constructor() {
    this.ws = null
    this.url = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
    this.isManualClose = false
    this.listeners = {
      open: [],
      close: [],
      message: [],
      error: [],
      midi: [],
      bpm: [],
    }
  }

  connect(url) {
    this.url = url
    this.isManualClose = false

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = (event) => {
        this.reconnectAttempts = 0
        this.emit('open', event)
      }

      this.ws.onclose = (event) => {
        this.emit('close', event)

        if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          setTimeout(() => {
            this.connect(this.url)
          }, this.reconnectDelay * this.reconnectAttempts)
        }
      }

      this.ws.onmessage = (event) => {
        this.emit('message', event)

        try {
          const data = JSON.parse(event.data)

          if (data.type === 'midi') {
            this.emit('midi', data.payload)
          } else if (data.type === 'bpm') {
            this.emit('bpm', data.payload)
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err)
        }
      }

      this.ws.onerror = (error) => {
        this.emit('error', error)
      }
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error)
    }
  }

  disconnect() {
    this.isManualClose = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket is not connected. Message not sent:', data)
    }
  }

  sendMidi(note, velocity, type = 'note_on') {
    this.send({
      type: 'midi',
      payload: {
        note,
        velocity,
        type,
        timestamp: Date.now(),
      },
    })
  }

  sendBpm(bpm) {
    this.send({
      type: 'bpm',
      payload: {
        bpm,
        timestamp: Date.now(),
      },
    })
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback)
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback
      )
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => {
        try {
          callback(data)
        } catch (err) {
          console.error(`Error in ${event} listener:`, err)
        }
      })
    }
  }

  getState() {
    if (!this.ws) return 'disconnected'
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting'
      case WebSocket.OPEN:
        return 'connected'
      case WebSocket.CLOSING:
        return 'closing'
      case WebSocket.CLOSED:
        return 'disconnected'
      default:
        return 'unknown'
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }
}

const wsManager = new WebSocketManager()

export default wsManager
