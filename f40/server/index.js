import http from 'http'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { LeveldbPersistence } from 'y-leveldb'

const PORT = 1234

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'running', message: 'Yjs WebSocket Server' }))
})

const wss = new WebSocketServer({ server })

const persistence = new LeveldbPersistence('./db')

const docs = new Map()

const messageSync = 0
const messageAwareness = 1
const messageAuth = 2

const updateHandler = (doc, docName, update, origin) => {
  const encoder = new Y.encoding.createEncoder()
  Y.encoding.writeVarUint(encoder, messageSync)
  Y.syncProtocol.writeUpdate(encoder, update)
  const message = Y.encoding.toUint8Array(encoder)
  
  doc.conns.forEach((_, conn) => {
    if (conn.readyState === 1) {
      conn.send(message)
    }
  })
}

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super()
    this.name = name
    this.conns = new Map()
    this.awareness = new Y.Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed)
      const encoder = new Y.encoding.createEncoder()
      Y.encoding.writeVarUint(encoder, messageAwareness)
      Y.encoding.writeVarUint8Array(
        encoder,
        Y.awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      )
      const buff = Y.encoding.toUint8Array(encoder)
      this.conns.forEach((_, c) => {
        if (c.readyState === 1) {
          c.send(buff)
        }
      })
    })

    this.on('update', (update, origin) => updateHandler(this, name, update, origin))
  }
}

const getYDoc = async (docName) => {
  let doc = docs.get(docName)
  if (!doc) {
    doc = new WSSharedDoc(docName)
    docs.set(docName, doc)
    
    const persistedData = await persistence.getYDoc(docName)
    if (persistedData) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(persistedData))
    }
  }
  return doc
}

wss.on('connection', async (conn, req) => {
  const docName = new URL(req.url, `http://${req.headers.host}`).pathname.slice(1) || 'default'
  
  console.log(`客户端连接: ${docName}`)
  
  const doc = await getYDoc(docName)
  
  doc.conns.set(conn, Set())

  conn.binaryType = 'arraybuffer'

  conn.on('message', (message) => {
    try {
      const encoder = new Y.encoding.createEncoder()
      const decoder = new Y.decoding.createDecoder(new Uint8Array(message))
      const messageType = Y.decoding.readVarUint(decoder)

      switch (messageType) {
        case messageSync:
          Y.encoding.writeVarUint(encoder, messageSync)
          Y.syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
          if (Y.encoding.length(encoder) > 1) {
            conn.send(Y.encoding.toUint8Array(encoder))
          }
          break
        case messageAwareness:
          Y.awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            Y.decoding.readVarUint8Array(decoder),
            conn
          )
          break
      }
    } catch (err) {
      console.error('消息处理错误:', err)
    }
  })

  conn.on('close', async () => {
    console.log(`客户端断开: ${docName}`)
    
    doc.conns.delete(conn)
    doc.awareness.removeAwarenessStates([doc.awareness.clientID], conn)
    
    if (doc.conns.size === 0) {
      await persistence.storeUpdate(docName, Y.encodeStateAsUpdate(doc))
      docs.delete(docName)
      doc.destroy()
      console.log(`文档 ${docName} 已持久化并卸载`)
    }
  })

  conn.on('error', (err) => {
    console.error('WebSocket 错误:', err)
  })

  const encoder = new Y.encoding.createEncoder()
  Y.encoding.writeVarUint(encoder, messageSync)
  Y.syncProtocol.writeSyncStep1(encoder, doc)
  conn.send(Y.encoding.toUint8Array(encoder))
  
  const awarenessStates = doc.awareness.getStates()
  if (awarenessStates.size > 0) {
    const encoder = new Y.encoding.createEncoder()
    Y.encoding.writeVarUint(encoder, messageAwareness)
    Y.encoding.writeVarUint8Array(
      encoder,
      Y.awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
    )
    conn.send(Y.encoding.toUint8Array(encoder))
  }
})

server.listen(PORT, () => {
  console.log(`Yjs WebSocket 服务器运行在 ws://localhost:${PORT}`)
})
