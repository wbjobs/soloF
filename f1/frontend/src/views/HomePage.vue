<template>
  <div class="min-h-screen bg-gradient-to-br from-dark-100 via-dark-200 to-dark-100 flex items-center justify-center p-8">
    <div class="w-full max-w-2xl">
      <div class="text-center mb-12">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/20 mb-6">
          <el-icon class="text-4xl text-primary"><VideoCamera /></el-icon>
        </div>
        <h1 class="text-4xl font-bold text-white mb-3">WebRTC 音视频会议</h1>
        <p class="text-dark-400 text-lg">自适应音频校准，提供最佳会议体验</p>
      </div>

      <div class="glass-effect rounded-2xl p-8">
        <el-tabs v-model="activeTab" class="meeting-tabs">
          <el-tab-pane label="创建会议" name="create">
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">您的昵称</label>
                <el-input 
                  v-model="createForm.userName" 
                  placeholder="请输入您的昵称"
                  size="large"
                  class="custom-input"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">会议名称</label>
                <el-input 
                  v-model="createForm.roomName" 
                  placeholder="请输入会议名称"
                  size="large"
                  class="custom-input"
                />
              </div>
              <el-button 
                type="primary" 
                size="large" 
                class="w-full h-12 text-base"
                :loading="creating"
                @click="createRoom"
              >
                创建并加入会议
              </el-button>
            </div>
          </el-tab-pane>
          
          <el-tab-pane label="加入会议" name="join">
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">您的昵称</label>
                <el-input 
                  v-model="joinForm.userName" 
                  placeholder="请输入您的昵称"
                  size="large"
                  class="custom-input"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">会议ID</label>
                <el-input 
                  v-model="joinForm.roomId" 
                  placeholder="请输入会议ID"
                  size="large"
                  class="custom-input"
                />
              </div>
              <el-button 
                type="primary" 
                size="large" 
                class="w-full h-12 text-base"
                :loading="joining"
                @click="joinRoom"
              >
                加入会议
              </el-button>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <div class="mt-8 grid grid-cols-3 gap-4">
        <div class="text-center p-4 rounded-xl bg-dark-200/50">
          <el-icon class="text-2xl text-primary mb-2"><Microphone /></el-icon>
          <p class="text-sm text-gray-300">智能降噪</p>
        </div>
        <div class="text-center p-4 rounded-xl bg-dark-200/50">
          <el-icon class="text-2xl text-success mb-2"><Connection /></el-icon>
          <p class="text-sm text-gray-300">回声消除</p>
        </div>
        <div class="text-center p-4 rounded-xl bg-dark-200/50">
          <el-icon class="text-2xl text-warning mb-2"><TrendCharts /></el-icon>
          <p class="text-sm text-gray-300">实时校准</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMeetingStore } from '@/stores/meeting'
import { ElMessage } from 'element-plus'
import { VideoCamera, Microphone, Connection, TrendCharts } from '@element-plus/icons-vue'

const router = useRouter()
const meetingStore = useMeetingStore()

const activeTab = ref('create')
const creating = ref(false)
const joining = ref(false)

const createForm = ref({
  userName: '',
  roomName: ''
})

const joinForm = ref({
  userName: '',
  roomId: ''
})

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

async function createRoom() {
  if (!createForm.value.userName.trim()) {
    ElMessage.warning('请输入您的昵称')
    return
  }
  if (!createForm.value.roomName.trim()) {
    ElMessage.warning('请输入会议名称')
    return
  }

  creating.value = true
  
  const roomId = generateRoomId()
  meetingStore.setUserInfo(createForm.value.userName)
  meetingStore.setRoomInfo(roomId, createForm.value.roomName)
  
  setTimeout(() => {
    creating.value = false
    router.push(`/room/${roomId}`)
  }, 500)
}

async function joinRoom() {
  if (!joinForm.value.userName.trim()) {
    ElMessage.warning('请输入您的昵称')
    return
  }
  if (!joinForm.value.roomId.trim()) {
    ElMessage.warning('请输入会议ID')
    return
  }

  joining.value = true
  
  meetingStore.setUserInfo(joinForm.value.userName)
  meetingStore.setRoomInfo(joinForm.value.roomId, '会议')
  
  setTimeout(() => {
    joining.value = false
    router.push(`/room/${joinForm.value.roomId}`)
  }, 500)
}
</script>

<style scoped>
.meeting-tabs :deep(.el-tabs__nav-wrap::after) {
  background: rgba(255, 255, 255, 0.1);
}

.meeting-tabs :deep(.el-tabs__item) {
  color: #86909C;
  font-size: 16px;
  font-weight: 500;
}

.meeting-tabs :deep(.el-tabs__item.is-active) {
  color: #165DFF;
}

.meeting-tabs :deep(.el-tabs__active-bar) {
  background: #165DFF;
}

.custom-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  box-shadow: none;
  color: white;
}

.custom-input :deep(.el-input__wrapper:hover) {
  border-color: rgba(22, 93, 255, 0.5);
}

.custom-input :deep(.el-input__wrapper.is-focus) {
  border-color: #165DFF;
}

.custom-input :deep(.el-input__inner) {
  color: white;
}

.custom-input :deep(.el-input__inner::placeholder) {
  color: #86909C;
}
</style>
