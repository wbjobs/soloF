import { createClient } from 'redis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

class RedisService {
  constructor() {
    this.client = null
  }

  async connect() {
    try {
      this.client = createClient({ url: REDIS_URL })
      
      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err)
      })

      this.client.on('connect', () => {
        console.log('Redis Client Connected')
      })

      await this.client.connect()
    } catch (error) {
      console.error('Failed to connect to Redis:', error)
      throw error
    }
  }

  async createRoom(roomId, roomName) {
    const roomData = {
      id: roomId,
      name: roomName,
      createdAt: Date.now(),
      participants: {}
    }
    await this.client.set(`room:${roomId}`, JSON.stringify(roomData))
    return roomData
  }

  async getRoom(roomId) {
    const data = await this.client.get(`room:${roomId}`)
    return data ? JSON.parse(data) : null
  }

  async deleteRoom(roomId) {
    await this.client.del(`room:${roomId}`)
  }

  async addParticipant(roomId, userId, userName) {
    const room = await this.getRoom(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    room.participants[userId] = {
      id: userId,
      name: userName,
      isAudioEnabled: true,
      isVideoEnabled: true,
      joinedAt: Date.now()
    }

    await this.client.set(`room:${roomId}`, JSON.stringify(room))
    return room
  }

  async removeParticipant(roomId, userId) {
    const room = await this.getRoom(roomId)
    if (!room) return null

    delete room.participants[userId]
    
    if (Object.keys(room.participants).length === 0) {
      await this.deleteRoom(roomId)
    } else {
      await this.client.set(`room:${roomId}`, JSON.stringify(room))
    }

    return room
  }

  async getParticipants(roomId) {
    const room = await this.getRoom(roomId)
    return room ? room.participants : {}
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect()
    }
  }
}

export const redisService = new RedisService()
