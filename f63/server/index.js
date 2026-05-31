import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import { getOrCreateDocument, documents } from './DocumentManager.js'

const app = express()
app.use(cors())

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const userColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
]

const userNames = [
  '用户A', '用户B', '用户C', '用户D', '用户E',
  '用户F', '用户G', '用户H', '用户I', '用户J'
]

function getRandomColor() {
  return userColors[Math.floor(Math.random() * userColors.length)]
}

function getRandomName() {
  return userNames[Math.floor(Math.random() * userNames.length)]
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id)

  socket.on('join-document', ({ docId }) => {
    const doc = getOrCreateDocument(docId)
    const userName = getRandomName()
    const userColor = getRandomColor()

    socket.join(docId)

    const users = doc.addUser(socket.id, userName, userColor)

    socket.emit('document-joined', {
      content: doc.getContent(),
      version: doc.getVersion(),
      userId: socket.id,
      userName,
      userColor,
      users
    })

    socket.to(docId).emit('user-joined', {
      userId: socket.id,
      userName,
      userColor,
      users
    })
  })

  socket.on('operation', ({ docId, op, clientVersion }) => {
    const doc = getOrCreateDocument(docId)
    const result = doc.applyOperation(op, clientVersion)

    if (result.applied) {
      socket.emit('operation-ack', {
        version: result.version,
        originalOp: op,
        transformedOp: result.transformedOp
      })

      socket.to(docId).emit('operation', {
        op: result.transformedOp,
        version: result.version
      })
    } else {
      socket.emit('operation-rejected', {
        version: result.version,
        content: result.content
      })
    }
  })

  socket.on('cursor-update', ({ docId, cursor }) => {
    const doc = getOrCreateDocument(docId)
    const users = doc.updateCursor(socket.id, cursor)
    
    socket.to(docId).emit('cursor-update', {
      userId: socket.id,
      cursor,
      users
    })
  })

  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id)
    
    for (const [docId, doc] of documents.entries()) {
      if (doc.users.has(socket.id)) {
        const users = doc.removeUser(socket.id)
        io.to(docId).emit('user-left', {
          userId: socket.id,
          users
        })
      }
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`协同编辑服务器运行在 http://localhost:${PORT}`)
})
