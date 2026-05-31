import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { redisService } from './redis.js'

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
})

app.use(cors())
app.use(express.json())

const userSockets = new Map()

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  socket.on('join-room', async ({ roomId, userId, userName }) => {
    try {
      console.log(`User ${userName} (${userId}) joining room ${roomId}`)

      socket.join(roomId)
      userSockets.set(userId, socket.id)

      let room = await redisService.getRoom(roomId)
      if (!room) {
        room = await redisService.createRoom(roomId, 'Conference Room')
      }

      await redisService.addParticipant(roomId, userId, userName)

      const participants = await redisService.getParticipants(roomId)

      socket.to(roomId).emit('user-joined', {
        id: userId,
        name: userName,
        participants
      })

      socket.emit('room-joined', {
        roomId,
        participants
      })
    } catch (error) {
      console.error('Error joining room:', error)
      socket.emit('error', { message: error.message })
    }
  })

  socket.on('signal', async ({ type, targetId, senderId, data }) => {
    const targetSocketId = userSockets.get(targetId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        type,
        senderId,
        data
      })
    }
  })

  socket.on('leave-room', async ({ roomId, userId }) => {
    try {
      socket.leave(roomId)
      
      const room = await redisService.removeParticipant(roomId, userId)
      
      socket.to(roomId).emit('user-left', {
        id: userId,
        participants: room ? room.participants : {}
      })

      userSockets.delete(userId)
    } catch (error) {
      console.error('Error leaving room:', error)
    }
  })

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id)
    
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId)
        
        const rooms = Array.from(socket.rooms)
        for (const roomId of rooms) {
          if (roomId !== socket.id) {
            try {
              const room = await redisService.removeParticipant(roomId, userId)
              socket.to(roomId).emit('user-left', {
                id: userId,
                participants: room ? room.participants : {}
              })
            } catch (error) {
              console.error('Error handling disconnect:', error)
            }
          }
        }
        break
      }
    }
  })
})

const PORT = process.env.PORT || 3001

async function startServer() {
  try {
    await redisService.connect()
    
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`WebSocket server ready`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await redisService.disconnect()
  httpServer.close(() => {
    process.exit(0)
  })
})

startServer()
