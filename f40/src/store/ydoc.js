import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'

const ROOM_NAME = 'todo-list-room'
const WEBSOCKET_URL = 'ws://localhost:1234'

class YDocStore {
  constructor() {
    this.ydoc = new Y.Doc()
    this.todosMap = this.ydoc.getMap('todos')
    this.orderArray = this.ydoc.getArray('order')
    this.listeners = new Set()
    this.isOnline = navigator.onLine
    this.wsProvider = null
    this.indexedDBPersistence = null
    
    this.history = []
    this.historyStartTime = Date.now()
    this.isTimeMachineActive = false
    this.timeMachineDoc = null
    this.currentTimePoint = null
    
    this.init()
  }

  init() {
    this.indexedDBPersistence = new IndexeddbPersistence('todo-crdt', this.ydoc)
    
    this.indexedDBPersistence.on('synced', () => {
      console.log('IndexedDB 同步完成')
      this.notifyListeners()
    })

    this.connectWebSocket()

    window.addEventListener('online', () => {
      this.isOnline = true
      this.connectWebSocket()
      this.notifyListeners()
    })

    window.addEventListener('offline', () => {
      this.isOnline = false
      this.notifyListeners()
    })

    this.ydoc.on('update', (update) => {
      if (!this.isTimeMachineActive) {
        this.recordHistory(update)
      }
      this.notifyListeners()
    })

    setInterval(() => this.cleanupDeletedTodos(), 60 * 60 * 1000)
    setInterval(() => this.cleanupOldHistory(), 60 * 60 * 1000)
    
    this.loadHistoryFromStorage()
  }

  cleanupDeletedTodos() {
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    
    this.todosMap.forEach((todo, id) => {
      if (todo.deleted && todo.deletedAt && todo.deletedAt < oneDayAgo) {
        this.todosMap.delete(id)
      }
    })
  }

  recordHistory(update) {
    const now = Date.now()
    this.history.push({
      timestamp: now,
      update: new Uint8Array(update)
    })
    this.saveHistoryToStorage()
  }

  cleanupOldHistory() {
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    this.history = this.history.filter(h => h.timestamp >= oneDayAgo)
    this.saveHistoryToStorage()
  }

  saveHistoryToStorage() {
    try {
      const historyData = this.history.map(h => ({
        timestamp: h.timestamp,
        update: Array.from(h.update)
      }))
      localStorage.setItem('todo-history', JSON.stringify(historyData))
    } catch (e) {
      console.warn('保存历史失败:', e)
    }
  }

  loadHistoryFromStorage() {
    try {
      const stored = localStorage.getItem('todo-history')
      if (stored) {
        const historyData = JSON.parse(stored)
        const now = Date.now()
        const oneDayAgo = now - 24 * 60 * 60 * 1000
        this.history = historyData
          .filter(h => h.timestamp >= oneDayAgo)
          .map(h => ({
            timestamp: h.timestamp,
            update: new Uint8Array(h.update)
          }))
      }
    } catch (e) {
      console.warn('加载历史失败:', e)
    }
  }

  getAvailableTimePoints() {
    if (this.history.length === 0) {
      return []
    }
    const points = []
    const interval = 5 * 60 * 1000
    let lastPoint = 0
    
    this.history.forEach(h => {
      if (h.timestamp - lastPoint >= interval) {
        points.push(h.timestamp)
        lastPoint = h.timestamp
      }
    })
    
    if (points.length === 0 || points[points.length - 1] !== this.history[this.history.length - 1].timestamp) {
      points.push(this.history[this.history.length - 1].timestamp)
    }
    
    return points
  }

  travelToTimePoint(targetTime) {
    if (this.history.length === 0) return false
    
    const validHistory = this.history.filter(h => h.timestamp <= targetTime)
    if (validHistory.length === 0) return false
    
    this.timeMachineDoc = new Y.Doc()
    this.isTimeMachineActive = true
    this.currentTimePoint = targetTime
    
    validHistory.forEach(h => {
      Y.applyUpdate(this.timeMachineDoc, h.update)
    })
    
    this.notifyListeners()
    return true
  }

  exitTimeMachine() {
    this.isTimeMachineActive = false
    this.timeMachineDoc = null
    this.currentTimePoint = null
    this.notifyListeners()
  }

  isInTimeMachine() {
    return this.isTimeMachineActive
  }

  getCurrentTimePoint() {
    return this.currentTimePoint
  }

  connectWebSocket() {
    if (this.wsProvider) {
      this.wsProvider.destroy()
    }

    this.wsProvider = new WebsocketProvider(
      WEBSOCKET_URL,
      ROOM_NAME,
      this.ydoc,
      {
        connect: true,
        resync: true
      }
    )

    this.wsProvider.on('status', (event) => {
      console.log('WebSocket 状态:', event.status)
      this.notifyListeners()
    })

    this.wsProvider.on('sync', (isSync) => {
      console.log('WebSocket 同步:', isSync ? '完成' : '进行中')
    })

    this.wsProvider.on('connection-close', () => {
      console.log('WebSocket 连接关闭')
    })
  }

  getConnectionStatus() {
    return this.wsProvider?.wsconnected ? 'connected' : this.isOnline ? 'connecting' : 'offline'
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.getState()))
  }

  getState() {
    const todos = []
    let todosMap, orderArray
    
    if (this.isTimeMachineActive && this.timeMachineDoc) {
      todosMap = this.timeMachineDoc.getMap('todos')
      orderArray = this.timeMachineDoc.getArray('order')
    } else {
      todosMap = this.todosMap
      orderArray = this.orderArray
    }
    
    const order = orderArray.toArray()
    
    order.forEach(id => {
      const todo = todosMap.get(id)
      if (todo && !todo.deleted) {
        todos.push({ ...todo, id })
      }
    })

    todosMap.forEach((todo, id) => {
      if (!order.includes(id) && !todo.deleted) {
        todos.push({ ...todo, id })
      }
    })

    return {
      todos,
      connectionStatus: this.getConnectionStatus(),
      isTimeMachine: this.isTimeMachineActive,
      currentTimePoint: this.currentTimePoint
    }
  }

  addTodo(text) {
    if (this.isTimeMachineActive) return
    const id = crypto.randomUUID()
    const todo = {
      text,
      completed: false,
      createdAt: Date.now()
    }
    
    this.ydoc.transact(() => {
      this.todosMap.set(id, todo)
      this.orderArray.unshift([id])
    })
  }

  toggleTodo(id) {
    if (this.isTimeMachineActive) return
    const todo = this.todosMap.get(id)
    if (todo && !todo.deleted) {
      this.todosMap.set(id, {
        ...todo,
        completed: !todo.completed
      })
    }
  }

  deleteTodo(id) {
    if (this.isTimeMachineActive) return
    const todo = this.todosMap.get(id)
    if (todo) {
      this.todosMap.set(id, {
        ...todo,
        deleted: true,
        deletedAt: Date.now()
      })
    }
    const index = this.orderArray.toArray().indexOf(id)
    if (index !== -1) {
      this.orderArray.delete(index, 1)
    }
  }

  updateTodoText(id, text) {
    if (this.isTimeMachineActive) return
    const todo = this.todosMap.get(id)
    if (todo && !todo.deleted) {
      this.todosMap.set(id, {
        ...todo,
        text
      })
    }
  }

  reorderTodos(fromIndex, toIndex) {
    if (this.isTimeMachineActive) return
    const order = this.orderArray.toArray()
    const [item] = order.splice(fromIndex, 1)
    order.splice(toIndex, 0, item)
    
    this.ydoc.transact(() => {
      this.orderArray.delete(0, this.orderArray.length)
      this.orderArray.push(order)
    })
  }
}

export const yDocStore = new YDocStore()
