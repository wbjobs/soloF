import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'

export const useNotesStore = defineStore('notes', () => {
  const currentNoteId = ref(null)
  const notes = ref(new Map())
  const isConnected = ref(false)
  const ydoc = ref(null)
  const provider = ref(null)
  const persistence = ref(null)
  const yNotesMap = ref(null)
  const activeNoteObservers = ref(new Map())

  const initYjs = () => {
    if (ydoc.value) return

    ydoc.value = new Y.Doc()
    yNotesMap.value = ydoc.value.getMap('notes')

    persistence.value = new IndexeddbPersistence('md-notes-v2', ydoc.value)
    
    provider.value = new WebsocketProvider(
      'ws://localhost:1234',
      'notes-app-v2',
      ydoc.value
    )

    provider.value.on('status', (event) => {
      isConnected.value = event.status === 'connected'
    })

    provider.value.on('synced', () => {
      loadAllNotes()
    })

    persistence.value.on('synced', () => {
      loadAllNotes()
    })

    yNotesMap.value.observeDeep((events) => {
      events.forEach(event => {
        if (event.target === yNotesMap.value) {
          event.keysChanged.forEach(key => {
            if (yNotesMap.value.has(key)) {
              setupNoteObservers(key)
            } else {
              cleanupNoteObservers(key)
            }
          })
        }
      })
      loadAllNotes()
    })
  }

  const setupNoteObservers = (noteId) => {
    if (activeNoteObservers.value.has(noteId)) return

    const noteYMap = yNotesMap.value.get(noteId)
    if (!noteYMap) return

    const observer = () => {
      loadAllNotes()
    }

    noteYMap.observeDeep(observer)
    activeNoteObservers.value.set(noteId, observer)
  }

  const cleanupNoteObservers = (noteId) => {
    activeNoteObservers.value.delete(noteId)
  }

  const loadAllNotes = () => {
    if (!yNotesMap.value) return
    
    const newNotes = new Map()
    yNotesMap.value.forEach((noteYMap, key) => {
      setupNoteObservers(key)
      newNotes.set(key, {
        id: key,
        title: noteYMap.get('title')?.toString() || '',
        content: noteYMap.get('content')?.toString() || '',
        images: noteYMap.get('images') || new Y.Map(),
        createdAt: noteYMap.get('createdAt') || Date.now(),
        updatedAt: noteYMap.get('updatedAt') || Date.now()
      })
    })
    notes.value = newNotes
  }

  const createNote = () => {
    if (!yNotesMap.value) initYjs()

    const id = Date.now().toString()
    const noteYMap = new Y.Map()
    
    const titleYText = new Y.Text('新笔记')
    const contentYText = new Y.Text('')
    const imagesYMap = new Y.Map()
    
    noteYMap.set('id', id)
    noteYMap.set('title', titleYText)
    noteYMap.set('content', contentYText)
    noteYMap.set('images', imagesYMap)
    noteYMap.set('createdAt', Date.now())
    noteYMap.set('updatedAt', Date.now())

    yNotesMap.value.set(id, noteYMap)
    setupNoteObservers(id)
    currentNoteId.value = id
    return id
  }

  const selectNote = (id) => {
    currentNoteId.value = id
  }

  const updateNoteTitle = (id, newTitle) => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return
    
    const noteYMap = yNotesMap.value.get(id)
    const titleYText = noteYMap.get('title')
    
    ydoc.value.transact(() => {
      titleYText.delete(0, titleYText.length)
      titleYText.insert(0, newTitle)
      noteYMap.set('updatedAt', Date.now())
    })
  }

  const updateNoteContent = (id, newContent) => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return
    
    const noteYMap = yNotesMap.value.get(id)
    const contentYText = noteYMap.get('content')
    
    ydoc.value.transact(() => {
      contentYText.delete(0, contentYText.length)
      contentYText.insert(0, newContent)
      noteYMap.set('updatedAt', Date.now())
    })
  }

  const addImageToNote = (id, imageId, base64Data) => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return
    
    const noteYMap = yNotesMap.value.get(id)
    const imagesYMap = noteYMap.get('images')
    
    ydoc.value.transact(() => {
      imagesYMap.set(imageId, base64Data)
      noteYMap.set('updatedAt', Date.now())
    })
  }

  const removeImageFromNote = (id, imageId) => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return
    
    const noteYMap = yNotesMap.value.get(id)
    const imagesYMap = noteYMap.get('images')
    
    ydoc.value.transact(() => {
      imagesYMap.delete(imageId)
      noteYMap.set('updatedAt', Date.now())
    })
  }

  const getNoteImages = (id) => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return new Map()
    
    const noteYMap = yNotesMap.value.get(id)
    const imagesYMap = noteYMap.get('images')
    const result = new Map()
    
    if (imagesYMap) {
      imagesYMap.forEach((value, key) => {
        result.set(key, value)
      })
    }
    
    return result
  }

  const getNoteYText = (id, field = 'content') => {
    if (!yNotesMap.value || !yNotesMap.value.has(id)) return null
    
    const noteYMap = yNotesMap.value.get(id)
    return noteYMap.get(field)
  }

  const deleteNote = (id) => {
    if (!yNotesMap.value) return
    
    cleanupNoteObservers(id)
    yNotesMap.value.delete(id)
    
    if (currentNoteId.value === id) {
      currentNoteId.value = null
    }
  }

  const currentNote = computed(() => {
    if (!currentNoteId.value || !notes.value) return null
    return notes.value.get(currentNoteId.value)
  })

  const notesList = computed(() => {
    if (!notes.value) return []
    return Array.from(notes.value.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const getNoteHistory = async (noteId) => {
    try {
      const response = await fetch(`http://localhost:1234/api/history/${noteId}`)
      const data = await response.json()
      return data.success ? data.history : []
    } catch (e) {
      console.error('Failed to get history:', e)
      return []
    }
  }

  const restoreVersion = async (noteId, timestamp) => {
    try {
      const response = await fetch(`http://localhost:1234/api/history/${noteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp })
      })
      const data = await response.json()
      return data.success
    } catch (e) {
      console.error('Failed to restore version:', e)
      return false
    }
  }

  const createSnapshot = async (noteId) => {
    try {
      const response = await fetch('http://localhost:1234/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId })
      })
      const data = await response.json()
      return data.success
    } catch (e) {
      console.error('Failed to create snapshot:', e)
      return false
    }
  }

  return {
    notes,
    currentNoteId,
    currentNote,
    notesList,
    isConnected,
    initYjs,
    createNote,
    selectNote,
    updateNoteTitle,
    updateNoteContent,
    addImageToNote,
    removeImageFromNote,
    getNoteImages,
    getNoteYText,
    deleteNote,
    getNoteHistory,
    restoreVersion,
    createSnapshot
  }
})
