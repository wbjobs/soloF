<template>
  <div class="app">
    <header class="header">
      <div style="display: flex; align-items: center;">
        <h1>📝 协同 Markdown 编辑器</h1>
        <span class="version-info">版本: {{ version }}</span>
      </div>
      <div class="header-right">
        <div class="connection-status">
          <span class="status-dot" :class="connectionStatus"></span>
          <span>{{ statusText }}</span>
        </div>
      </div>
    </header>
    
    <div class="main-container">
      <div class="editor-wrapper">
        <CodeMirrorEditor
          ref="editorRef"
          v-model="content"
          :user-id="userId"
          :remote-cursors="displayCursors"
          @operation="handleOperation"
          @cursor-change="handleCursorChange"
        />
      </div>
      
      <aside class="sidebar">
        <div class="sidebar-header">
          <h3>👥 在线用户</h3>
          <span class="user-count">{{ users.length }} 人在线</span>
        </div>
        
        <div class="user-list-sidebar">
          <div
            v-for="user in users"
            :key="user.id"
            class="user-item"
            :class="{ 'is-self': user.id === userId }"
          >
            <div
              class="user-avatar-large"
              :style="{ background: user.color }"
            >
              {{ user.name.charAt(user.name.length - 1) }}
            </div>
            <div class="user-info">
              <div class="user-name">
                {{ user.name }}
                <span v-if="user.id === userId" class="self-badge">我</span>
              </div>
              <div class="user-status">
                <span
                  class="cursor-indicator"
                  :class="{ 'active': user.cursor }"
                ></span>
                {{ user.cursor ? '正在编辑' : '正在查看' }}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import CodeMirrorEditor from './components/CodeMirrorEditor.vue'
import { CollabClient } from './collabClient.js'

const DOC_ID = 'shared-doc-1'

const editorRef = ref(null)
const content = ref('')
const userId = ref('')
const userName = ref('')
const userColor = ref('')
const version = ref(0)
const users = ref([])
const connectionStatus = ref('connecting')
const remoteCursorPositions = ref({})

const collabClient = ref(null)

const statusText = computed(() => {
  switch (connectionStatus.value) {
    case 'connected': return '已连接'
    case 'connecting': return '连接中...'
    case 'disconnected': return '已断开'
    default: return '未知'
  }
})

const displayCursors = computed(() => {
  const result = []
  for (const [uid, cursorData] of Object.entries(remoteCursorPositions.value)) {
    if (uid !== userId.value && cursorData && cursorData.cursor) {
      const coords = editorRef.value?.getCaretCoordinates(cursorData.cursor.head)
      if (coords) {
        result.push({
          userId: uid,
          userName: cursorData.userName,
          color: cursorData.color,
          ...coords
        })
      }
    }
  }
  return result
})

function handleOperation(op) {
  if (collabClient.value) {
    collabClient.value.sendOperation(op)
  }
}

let cursorUpdateTimeout = null
function handleCursorChange(cursor) {
  if (collabClient.value) {
    if (cursorUpdateTimeout) {
      clearTimeout(cursorUpdateTimeout)
    }
    cursorUpdateTimeout = setTimeout(() => {
      collabClient.value.sendCursorUpdate(cursor)
    }, 50)
  }
}

onMounted(() => {
  collabClient.value = new CollabClient(DOC_ID, userId.value)
  
  collabClient.value.on('ready', (data) => {
    userId.value = data.userId
    userName.value = data.userName
    userColor.value = data.userColor
    content.value = data.content
    version.value = data.version
    users.value = data.users
    connectionStatus.value = 'connected'
    
    editorRef.value?.setContent(data.content)
  })
  
  collabClient.value.on('remote-operation', (op) => {
    editorRef.value?.applyRemoteOp(op)
    version.value = collabClient.value.getVersion()
  })
  
  collabClient.value.on('content-reset', (newContent) => {
    content.value = newContent
    editorRef.value?.setContent(newContent)
  })
  
  collabClient.value.on('user-joined', (data) => {
    users.value = data.users
  })
  
  collabClient.value.on('user-left', (data) => {
    users.value = data.users
    delete remoteCursorPositions.value[data.userId]
  })
  
  collabClient.value.on('cursor-update', (data) => {
    const userIndex = users.value.findIndex(u => u.id === data.userId)
    if (userIndex !== -1) {
      users.value[userIndex] = {
        ...users.value[userIndex],
        cursor: data.cursor
      }
      remoteCursorPositions.value[data.userId] = {
        cursor: data.cursor,
        userName: users.value[userIndex].name,
        color: users.value[userIndex].color
      }
    }
  })
  
  collabClient.value.on('disconnect', () => {
    connectionStatus.value = 'disconnected'
  })
  
  collabClient.value.connect()
})

onUnmounted(() => {
  if (collabClient.value) {
    collabClient.value.disconnect()
  }
  if (cursorUpdateTimeout) {
    clearTimeout(cursorUpdateTimeout)
  }
})
</script>
