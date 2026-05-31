import { createInsert, applyOperation, transform, transformOperationAgainstHistory } from './ot.js'

console.log('=== 模拟完整的协同编辑流程 ===\n')

class MockServer {
  constructor() {
    this.content = ''
    this.version = 0
    this.history = []
    this.clients = new Map()
  }

  applyOperation(clientId, op, clientVersion) {
    const historySinceClient = this.history.slice(clientVersion)
    const transformedOp = transformOperationAgainstHistory(op, historySinceClient)
    
    if (!transformedOp) {
      return { applied: false, content: this.content, version: this.version }
    }

    this.content = applyOperation(this.content, transformedOp)
    this.version++
    
    const opWithVersion = { ...transformedOp, version: this.version }
    this.history.push(opWithVersion)

    this.broadcast(clientId, opWithVersion)

    return {
      applied: true,
      content: this.content,
      version: this.version,
      transformedOp: opWithVersion
    }
  }

  broadcast(fromClientId, op) {
    for (const [clientId, client] of this.clients) {
      if (clientId !== fromClientId) {
        client.receiveRemoteOp(op)
      }
    }
  }

  registerClient(clientId, client) {
    this.clients.set(clientId, client)
  }
}

class MockClient {
  constructor(id, server) {
    this.id = id
    this.server = server
    this.content = ''
    this.version = 0
    this.pendingOp = null
    this.localHistory = []
    this.isApplyingRemote = false
    this.logs = []
  }

  log(msg) {
    this.logs.push(`[${this.id}] ${msg}`)
    console.log(`[${this.id}] ${msg}`)
  }

  localInsert(position, text) {
    const op = { 
      type: 'insert', 
      position, 
      text, 
      userId: this.id, 
      timestamp: Date.now() + Math.random() 
    }
    
    this.log(`本地插入: "${text}" at ${position}`)
    this.sendOperation(op)
  }

  sendOperation(op) {
    if (this.isApplyingRemote) return

    this.content = applyOperation(this.content, op)
    this.log(`本地内容变为: "${this.content}"`)

    if (!this.pendingOp) {
      this.pendingOp = op
      this.log(`发送操作到服务器, 版本: ${this.version}`)
      setTimeout(() => {
        const result = this.server.applyOperation(this.id, op, this.version)
        this.handleAck(result)
      }, Math.random() * 100)
    } else {
      this.localHistory.push(op)
      this.log(`加入本地队列，pendingOp已存在`)
    }
  }

  handleAck(result) {
    if (result.applied && this.pendingOp) {
      this.pendingOp = null
      this.version = result.version
      this.log(`收到确认，版本更新为: ${this.version}`)
      this.sendPending()
    }
  }

  sendPending() {
    if (this.localHistory.length > 0 && !this.pendingOp) {
      const op = this.localHistory.shift()
      this.pendingOp = op
      this.log(`发送队列中的操作, 版本: ${this.version}`)
      setTimeout(() => {
        const result = this.server.applyOperation(this.id, op, this.version)
        this.handleAck(result)
      }, Math.random() * 100)
    }
  }

  receiveRemoteOp(op) {
    this.isApplyingRemote = true
    this.log(`收到远程操作: ${JSON.stringify(op)}`)
    
    let opToApply = { ...op }
    
    if (this.pendingOp) {
      const [transformedPending, transformedRemote] = transform(this.pendingOp, opToApply)
      this.pendingOp = transformedPending
      opToApply = transformedRemote
      this.log(`针对pendingOp转换后: ${JSON.stringify(opToApply)}`)
    }
    
    const newLocalHistory = []
    for (const localOp of this.localHistory) {
      const [transformedLocal, transformedRemote] = transform(localOp, opToApply)
      newLocalHistory.push(transformedLocal)
      opToApply = transformedRemote
    }
    this.localHistory = newLocalHistory
    
    if (opToApply.type !== 'delete' || opToApply.length > 0) {
      this.content = applyOperation(this.content, opToApply)
      this.log(`应用远程操作后内容: "${this.content}"`)
    }
    
    this.version = op.version
    this.isApplyingRemote = false
  }
}

const server = new MockServer()
const clientA = new MockClient('A', server)
const clientB = new MockClient('B', server)

server.registerClient('A', clientA)
server.registerClient('B', clientB)

console.log('初始状态: 空文档\n')

console.log('=== 并发插入测试 ===')
console.log('A在开头插入"Hello"')
console.log('B同时在开头插入"World"\n')

clientA.localInsert(0, 'Hello')
clientB.localInsert(0, 'World')

setTimeout(() => {
  console.log('\n=== 1秒后状态 ===')
  console.log(`服务器内容: "${server.content}"`)
  console.log(`客户端A内容: "${clientA.content}"`)
  console.log(`客户端B内容: "${clientB.content}"`)
  console.log(`服务器版本: ${server.version}`)
  console.log(`客户端A版本: ${clientA.version}`)
  console.log(`客户端B版本: ${clientB.version}`)
  console.log(`内容一致: ${server.content === clientA.content && clientA.content === clientB.content}`)
  
  if (server.content !== clientA.content || server.content !== clientB.content) {
    console.log('\n❌ 内容不一致，存在bug!')
  } else {
    console.log('\n✅ 内容一致，bug已修复!')
  }
}, 500)
