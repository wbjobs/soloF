import { WebSocketServer } from 'ws'
import http from 'http'
import * as Y from 'yjs'
import { LeveldbPersistence } from 'y-leveldb'
import { setupWSConnection } from 'y-websocket/bin/utils'

const wss = new WebSocketServer({ noServer: true })
const persistence = new LeveldbPersistence('./db')
const docs = new Map()
const versionHistoryPrefix = 'version_'
const SNAPSHOT_INTERVAL = 60000

const getDoc = async (docName) => {
  if (docs.has(docName)) {
    return docs.get(docName)
  }

  const ydoc = new Y.Doc()
  docs.set(docName, ydoc)

  try {
    const persistedYdoc = await persistence.getYDoc(docName)
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc))
  } catch (e) {
    console.log('Creating new document:', docName)
  }

  ydoc.on('update', (update, origin) => {
    if (origin !== persistence) {
      persistence.storeUpdate(docName, update)
    }
  })

  return ydoc
}

const saveSnapshot = async (docName, noteId) => {
  const ydoc = await getDoc(docName)
  const notesMap = ydoc.getMap('notes')
  const noteYMap = notesMap.get(noteId)
  
  if (!noteYMap) return

  const snapshot = {
    id: `${noteId}_${Date.now()}`,
    noteId,
    timestamp: Date.now(),
    stateVector: Buffer.from(Y.encodeStateVector(ydoc)),
    fullUpdate: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    title: noteYMap.get('title')?.toString() || '',
    preview: (noteYMap.get('content')?.toString() || '').slice(0, 100)
  }

  const key = `${versionHistoryPrefix}${docName}_${noteId}_${snapshot.timestamp}`
  await persistence._db.put(key, JSON.stringify({
    ...snapshot,
    stateVector: snapshot.stateVector.toString('base64'),
    fullUpdate: snapshot.fullUpdate.toString('base64')
  }))
  
  console.log(`Snapshot saved for note ${noteId} at ${new Date(snapshot.timestamp).toLocaleString()}`)
  return snapshot
}

const getNoteHistory = async (docName, noteId) => {
  const prefix = `${versionHistoryPrefix}${docName}_${noteId}_`
  const versions = []
  
  for await (const [key, value] of persistence._db.iterator({ gte: prefix })) {
    if (!key.startsWith(prefix)) break
    try {
      const version = JSON.parse(value)
      versions.push({
        id: version.id,
        noteId: version.noteId,
        timestamp: version.timestamp,
        title: version.title,
        preview: version.preview
      })
    } catch (e) {
      console.error('Error parsing version:', e)
    }
  }
  
  return versions.sort((a, b) => b.timestamp - a.timestamp)
}

const restoreVersion = async (docName, noteId, timestamp) => {
  const key = `${versionHistoryPrefix}${docName}_${noteId}_${timestamp}`
  const value = await persistence._db.get(key)
  
  if (!value) throw new Error('Version not found')
  
  const version = JSON.parse(value)
  const ydoc = await getDoc(docName)
  
  const updateBuffer = Buffer.from(version.fullUpdate, 'base64')
  const updateUint8 = new Uint8Array(updateBuffer)
  
  ydoc.transact(() => {
    Y.applyUpdate(ydoc, updateUint8, 'restore')
  })
  
  return { success: true, timestamp: version.timestamp }
}

const activeNotes = new Map()

const registerNoteActivity = (noteId) => {
  activeNotes.set(noteId, Date.now())
}

const startSnapshotService = () => {
  setInterval(async () => {
    const now = Date.now()
    const notesToSave = []
    
    for (const [noteId, lastActivity] of activeNotes) {
      if (now - lastActivity < 5 * 60 * 1000) {
        notesToSave.push(noteId)
      }
    }
    
    for (const noteId of notesToSave) {
      try {
        await saveSnapshot('notes-app', noteId)
      } catch (e) {
        console.error(`Failed to snapshot note ${noteId}:`, e)
      }
    }
  }, SNAPSHOT_INTERVAL)
  
  console.log(`Snapshot service started (interval: ${SNAPSHOT_INTERVAL / 1000}s, track ${activeNotes.size} notes)`)
}

wss.on('connection', async (conn, req) => {
  const url = new URL(req.url, 'http://localhost')
  const docName = url.pathname.slice(1) || 'default'

  await getDoc(docName)

  setupWSConnection(conn, req, { 
    docName,
    gc: true
  })

  console.log('Client connected to document:', docName)
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (path.startsWith('/api/history/')) {
    const noteId = path.split('/').pop()
    
    if (req.method === 'GET') {
      try {
        const history = await getNoteHistory('notes-app', noteId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, history }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
      return
    }
    
    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', async () => {
        try {
          const { timestamp } = JSON.parse(body)
          const result = await restoreVersion('notes-app', noteId, timestamp)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })
      return
    }
  }
  
  if (path === '/api/snapshot' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { noteId } = JSON.parse(body)
        registerNoteActivity(noteId)
        const snapshot = await saveSnapshot('notes-app', noteId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, snapshot }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: e.message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

server.listen(1234, () => {
  console.log('Server running on port 1234')
  console.log('- WebSocket: ws://localhost:1234')
  console.log('- HTTP API: http://localhost:1234/api')
  startSnapshotService()
})
