<script setup>
import { ref, watch, onMounted } from 'vue'
import { useNotesStore } from '../stores/notes'

const store = useNotesStore()
const showTimeline = ref(false)
const history = ref([])
const loading = ref(false)

const loadHistory = async () => {
  if (!store.currentNoteId) return
  
  loading.value = true
  history.value = await store.getNoteHistory(store.currentNoteId)
  loading.value = false
}

const handleRestore = async (version) => {
  const confirmed = confirm(`确定要回滚到 ${formatTime(version.timestamp)} 的版本吗？`)
  if (!confirmed) return
  
  const success = await store.restoreVersion(store.currentNoteId, version.timestamp)
  if (success) {
    alert('版本回滚成功！')
    loadHistory()
  } else {
    alert('版本回滚失败')
  }
}

const handleCreateSnapshot = async () => {
  if (!store.currentNoteId) return
  
  const success = await store.createSnapshot(store.currentNoteId)
  if (success) {
    alert('快照创建成功！')
    loadHistory()
  } else {
    alert('快照创建失败')
  }
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

watch(() => store.currentNoteId, () => {
  if (showTimeline.value) {
    loadHistory()
  }
})

defineExpose({ loadHistory })
</script>

<template>
  <div class="version-timeline-container">
    <button 
      class="timeline-toggle-btn"
      @click="showTimeline = !showTimeline; if (showTimeline) loadHistory()"
    >
      <span v-if="showTimeline">✕</span>
      <span v-else>📜 版本历史</span>
    </button>

    <div v-if="showTimeline" class="timeline-panel">
      <div class="timeline-header">
        <h3>版本历史</h3>
        <button class="snapshot-btn" @click="handleCreateSnapshot">
          📷 创建快照
        </button>
      </div>

      <div v-if="loading" class="loading-state">
        加载中...
      </div>

      <div v-else-if="history.length === 0" class="empty-state">
        暂无历史版本
      </div>

      <div v-else class="timeline-list">
        <div 
          v-for="(version, index) in history" 
          :key="version.id"
          class="timeline-item"
        >
          <div class="timeline-marker">
            <div class="marker-dot"></div>
            <div v-if="index < history.length - 1" class="marker-line"></div>
          </div>
          
          <div class="timeline-content">
            <div class="version-time">{{ formatTime(version.timestamp) }}</div>
            <div class="version-title">{{ version.title || '无标题' }}</div>
            <div class="version-preview">{{ version.preview || '无内容' }}</div>
            <button 
              class="restore-btn"
              @click="handleRestore(version)"
            >
              恢复到此版本
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-timeline-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1000;
}

.timeline-toggle-btn {
  padding: 10px 16px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
  transition: all 0.2s;
}

.timeline-toggle-btn:hover {
  background: #1d4ed8;
}

.timeline-panel {
  position: absolute;
  top: 50px;
  right: 0;
  width: 340px;
  max-height: 60vh;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.timeline-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}

.timeline-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.snapshot-btn {
  padding: 6px 12px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.snapshot-btn:hover {
  background: #059669;
}

.loading-state,
.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: #6b7280;
  font-size: 14px;
}

.timeline-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}

.timeline-item {
  display: flex;
  gap: 12px;
  padding: 0 16px;
  margin-bottom: 8px;
}

.timeline-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.marker-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #2563eb;
  border: 2px solid #dbeafe;
}

.marker-line {
  width: 2px;
  flex: 1;
  background: #e5e7eb;
  margin-top: 4px;
}

.timeline-content {
  flex: 1;
  padding-bottom: 16px;
}

.version-time {
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
  margin-bottom: 4px;
}

.version-title {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 2px;
}

.version-preview {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.restore-btn {
  padding: 4px 10px;
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.restore-btn:hover {
  background: #e5e7eb;
  color: #1f2937;
}
</style>
