<script setup>
import { onMounted, ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { marked } from 'marked'
import { useNotesStore } from './stores/notes'
import { YTextBinding } from './utils/y-text-binding'
import VersionTimeline from './components/VersionTimeline.vue'

const store = useNotesStore()
const contentTextarea = ref(null)
const titleInput = ref(null)
const localContent = ref('')
const contentBinding = ref(null)
const titleBinding = ref(null)

watch(() => store.currentNoteId, async (newNoteId) => {
  if (contentBinding.value) {
    contentBinding.value.destroy()
    contentBinding.value = null
  }
  if (titleBinding.value) {
    titleBinding.value.destroy()
    titleBinding.value = null
  }
  
  if (newNoteId) {
    await nextTick()
    setupBindings(newNoteId)
  }
}, { immediate: true })

const setupBindings = (noteId) => {
  const contentYText = store.getNoteYText(noteId, 'content')
  const titleYText = store.getNoteYText(noteId, 'title')
  
  if (contentYText && contentTextarea.value) {
    contentBinding.value = new YTextBinding(contentYText, contentTextarea.value)
    contentTextarea.value.addEventListener('y-update', () => {
      localContent.value = contentYText.toString()
    })
    localContent.value = contentYText.toString()
  }
  
  if (titleYText && titleInput.value) {
    titleBinding.value = new YTextBinding(titleYText, titleInput.value)
  }
}

const handlePaste = async (e) => {
  if (!store.currentNoteId || !contentTextarea.value) return
  
  const items = e.clipboardData.items
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault()
      const file = items[i].getAsFile()
      if (file) {
        const base64 = await fileToBase64(file)
        const imageId = 'img_' + Date.now()
        store.addImageToNote(store.currentNoteId, imageId, base64)
        
        const imageMarkdown = `![${imageId}](${imageId})`
        const textarea = contentTextarea.value
        const cursorPos = textarea.selectionStart
        const currentText = textarea.value
        const newContent = currentText.slice(0, cursorPos) + 
                          '\n' + imageMarkdown + '\n' + 
                          currentText.slice(cursorPos)
        
        textarea.value = newContent
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
      break
    }
  }
}

const fileToBase64 = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsDataURL(file)
  })
}

const renderMarkdown = (text, images) => {
  if (!text) return ''
  
  let processed = text
  if (images) {
    images.forEach((base64Data, imageId) => {
      const regex = new RegExp(`!\\[${imageId}\\]\\(${imageId}\\)`, 'g')
      processed = processed.replace(regex, `<img src="${base64Data}" style="max-width: 100%; border-radius: 4px; margin: 8px 0;" />`)
    })
  }
  
  return marked.parse(processed)
}

const renderedContent = computed(() => {
  if (!store.currentNote) return ''
  const images = store.getNoteImages(store.currentNoteId)
  return renderMarkdown(localContent.value, images)
})

const getPreviewText = (content) => {
  return content.replace(/[#*`\[\]]/g, '').slice(0, 50)
}

onUnmounted(() => {
  if (contentBinding.value) {
    contentBinding.value.destroy()
  }
  if (titleBinding.value) {
    titleBinding.value.destroy()
  }
})
</script>

<template>
  <div class="app">
    <div class="sidebar">
      <div class="sidebar-header">
        <h1>📝 离线笔记</h1>
        <button class="create-btn" @click="store.createNote()">
          + 新建笔记
        </button>
      </div>
      
      <div class="notes-list">
        <div
          v-for="note in store.notesList"
          :key="note.id"
          class="note-item"
          :class="{ active: store.currentNoteId === note.id }"
          @click="store.selectNote(note.id)"
        >
          <div class="note-title">{{ note.title }}</div>
          <div class="note-preview">{{ getPreviewText(note.content) || '无内容' }}</div>
        </div>
        <div v-if="store.notesList.length === 0" style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
          暂无笔记，点击上方按钮创建
        </div>
      </div>

      <div class="status-bar">
        <div class="status-indicator">
          <span class="status-dot" :class="{ offline: !store.isConnected }"></span>
          {{ store.isConnected ? '已连接' : '离线模式' }}
        </div>
      </div>
    </div>

    <div class="main-content">
      <template v-if="store.currentNote">
        <div class="editor-header">
          <input
            ref="titleInput"
            type="text"
            class="note-title-input"
            placeholder="输入笔记标题..."
          />
        </div>
        <div class="editor-container">
          <div class="editor-pane">
            <div class="pane-header">编辑（可直接粘贴图片）</div>
            <textarea
              ref="contentTextarea"
              class="editor-textarea"
              @paste="handlePaste"
              placeholder="在这里输入 Markdown 内容，或直接粘贴图片..."
            ></textarea>
          </div>
          <div class="editor-pane">
            <div class="pane-header">预览</div>
            <div class="preview-pane" v-html="renderedContent"></div>
          </div>
        </div>
      </template>
      <div v-else class="empty-state">
        选择或创建一篇笔记开始编辑
      </div>
    </div>
    
    <VersionTimeline />
  </div>
</template>
