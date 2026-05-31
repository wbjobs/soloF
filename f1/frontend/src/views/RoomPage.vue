<template>
  <div class="min-h-screen bg-dark-100 flex flex-col">
    <header class="flex items-center justify-between px-6 py-4 border-b border-dark-300/30">
      <div class="flex items-center gap-4">
        <el-button 
          type="text" 
          @click="leaveRoom"
          class="text-gray-400 hover:text-white"
        >
          <el-icon class="text-xl"><ArrowLeft /></el-icon>
        </el-button>
        <div>
          <h1 class="text-xl font-semibold text-white">{{ meetingStore.roomName }}</h1>
          <p class="text-sm text-gray-400">会议ID: {{ meetingStore.roomId }}</p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="text-sm text-gray-400">
          <span v-if="voicePrint.recognizedUser" class="text-success font-medium">
            ✓ 已识别: {{ voicePrint.recognizedUser }}
          </span>
          <span v-else-if="voicePrint.isVoiceLockEnabled && voicePrint.lastResult.confidence > 0" class="text-warning">
            ⚠ 未授权声源被过滤
          </span>
        </div>
        <el-button 
          :type="showCalibrationPanel ? 'primary' : 'default'"
          @click="toggleCalibrationPanel"
          class="bg-dark-200 border-0 text-white hover:bg-dark-300"
        >
          <el-icon class="mr-1"><Setting /></el-icon>
          音频控制台
        </el-button>
        <el-button 
          type="danger" 
          @click="leaveRoom"
          class="rounded-full"
        >
          <el-icon class="mr-1"><SwitchButton /></el-icon>
          离开
        </el-button>
      </div>
    </header>

    <main class="flex-1 flex p-6 gap-6 overflow-hidden">
      <div class="flex-1 grid grid-cols-2 gap-4 auto-rows-fr">
        <div 
          class="video-container relative transition-all duration-300" 
          :class="{ 
            'border-2 border-success': isSpeaking && voicePrint.recognizedUser,
            'border-2 border-warning': isSpeaking && !voicePrint.recognizedUser && voicePrint.isVoiceLockEnabled,
            'border-2 border-primary': isSpeaking && !voicePrint.isVoiceLockEnabled
          }"
        >
          <video 
            ref="localVideoRef" 
            autoplay 
            muted 
            playsinline
            class="w-full h-full object-cover rounded-xl"
          />
          <div class="absolute bottom-4 left-4 flex items-center gap-2">
            <span class="px-3 py-1 bg-black/50 rounded-full text-white text-sm">
              {{ meetingStore.userName }} (你)
            </span>
            <el-icon 
              v-if="!meetingStore.isAudioEnabled" 
              class="text-danger text-lg"
            >
              <MicrophoneOff />
            </el-icon>
            <el-icon 
              v-if="!meetingStore.isVideoEnabled" 
              class="text-danger text-lg"
            >
              <VideoCameraOff />
            </el-icon>
            <el-icon 
              v-if="isSpeaking && voicePrint.recognizedUser" 
              class="text-success text-lg animate-pulse"
            >
              <Microphone />
            </el-icon>
            <el-icon 
              v-if="isSpeaking && !voicePrint.recognizedUser && voicePrint.isVoiceLockEnabled" 
              class="text-warning text-lg animate-pulse"
            >
              <Lock />
            </el-icon>
          </div>
        </div>

        <div 
          v-for="participant in meetingStore.participants" 
          :key="participant.id"
          class="video-container relative"
        >
          <video 
            :ref="el => setRemoteVideoRef(el, participant.id)"
            autoplay 
            playsinline
            class="w-full h-full object-cover rounded-xl"
          />
          <div class="absolute bottom-4 left-4 flex items-center gap-2">
            <span class="px-3 py-1 bg-black/50 rounded-full text-white text-sm">
              {{ participant.name }}
            </span>
            <el-icon 
              v-if="!participant.isAudioEnabled" 
              class="text-danger text-lg"
            >
              <MicrophoneOff />
            </el-icon>
            <el-icon 
              v-if="!participant.isVideoEnabled" 
              class="text-danger text-lg"
            >
              <VideoCameraOff />
            </el-icon>
          </div>
        </div>

        <div 
          v-if="meetingStore.participants.length === 0"
          class="video-container flex items-center justify-center"
        >
          <div class="text-center">
            <el-icon class="text-6xl text-gray-500 mb-4"><User /></el-icon>
            <p class="text-gray-400">等待其他参与者加入...</p>
          </div>
        </div>
      </div>

      <aside 
        v-if="showCalibrationPanel" 
        class="w-96 glass-effect rounded-xl p-6 overflow-y-auto scrollbar-thin"
      >
        <el-tabs v-model="activeTab" class="dark-tabs">
          <el-tab-pane label="音频校准" name="calibration">
            <div class="space-y-6">
              <div>
                <div class="flex items-center justify-between mb-3">
                  <span class="text-sm text-gray-300">校准进度</span>
                  <span class="text-sm text-primary font-medium">{{ calibrationProgress }}%</span>
                </div>
                <el-progress 
                  :percentage="calibrationProgress" 
                  :stroke-width="8"
                  class="custom-progress"
                />
              </div>

              <div class="space-y-3">
                <div 
                  class="flex items-center justify-between p-3 rounded-lg transition-all"
                  :class="currentStep === 'ambient-noise' ? 'bg-primary/20 border border-primary/30' : 'bg-dark-200'"
                >
                  <span class="text-sm text-gray-300">环境噪声采样</span>
                  <el-icon v-if="calibrationProgress > 5" class="text-success"><Check /></el-icon>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg transition-all"
                  :class="currentStep === 'sine-wave' ? 'bg-primary/20 border border-primary/30' : 'bg-dark-200'"
                >
                  <span class="text-sm text-gray-300">正弦波测试</span>
                  <el-icon v-if="calibrationProgress > 15" class="text-success"><Check /></el-icon>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg transition-all"
                  :class="currentStep === 'pink-noise' ? 'bg-primary/20 border border-primary/30' : 'bg-dark-200'"
                >
                  <span class="text-sm text-gray-300">粉红噪声测试</span>
                  <el-icon v-if="calibrationProgress > 45" class="text-success"><Check /></el-icon>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg transition-all"
                  :class="currentStep === 'speech' ? 'bg-primary/20 border border-primary/30' : 'bg-dark-200'"
                >
                  <span class="text-sm text-gray-300">语音片段测试</span>
                  <el-icon v-if="calibrationProgress > 75" class="text-success"><Check /></el-icon>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg transition-all"
                  :class="currentStep === 'analysis' ? 'bg-primary/20 border border-primary/30' : 'bg-dark-200'"
                >
                  <span class="text-sm text-gray-300">参数分析计算</span>
                  <el-icon v-if="calibrationProgress >= 100" class="text-success"><Check /></el-icon>
                </div>
              </div>

              <div>
                <h3 class="text-sm font-medium text-gray-300 mb-3">实时频谱分析</h3>
                <div class="h-24 bg-dark-200 rounded-lg overflow-hidden relative">
                  <svg width="100%" height="100%" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="voiceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#165DFF" stop-opacity="0.8" />
                        <stop offset="100%" stop-color="#165DFF" stop-opacity="0.2" />
                      </linearGradient>
                      <linearGradient id="noiseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#FF7D00" stop-opacity="0.8" />
                        <stop offset="100%" stop-color="#FF7D00" stop-opacity="0.2" />
                      </linearGradient>
                    </defs>
                    <g>
                      <rect
                        v-for="(height, i) in spectrumBars"
                        :key="'v-' + i"
                        :x="(i * 100 / spectrumBars.length) + '%'"
                        :y="(96 - height * 96 * 0.8) + '%'"
                        :width="(90 / spectrumBars.length) + '%'"
                        :height="(height * 96 * 0.8) + '%'"
                        :fill="isVoiceAtBand(i) ? 'url(#voiceGradient)' : 'url(#noiseGradient)'"
                        rx="2"
                      />
                    </g>
                  </svg>
                </div>
              </div>

              <div class="p-4 bg-dark-200 rounded-lg">
                <h3 class="text-sm font-medium text-gray-300 mb-3">语音检测状态</h3>
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-400">人声概率</span>
                    <span 
                      class="text-xs font-medium"
                      :class="audioFeatures.voiceProbability > 0.5 ? 'text-primary' : 'text-gray-400'"
                    >
                      {{ (audioFeatures.voiceProbability * 100).toFixed(1) }}%
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-400">检测置信度</span>
                    <span class="text-xs text-success font-medium">
                      {{ (audioFeatures.confidence * 100).toFixed(1) }}%
                    </span>
                  </div>
                </div>
              </div>

              <el-button 
                type="primary" 
                class="w-full h-12"
                :loading="isCalibrating"
                :disabled="isCalibrating && calibrationProgress > 0"
                @click="startCalibration"
              >
                {{ calibrationProgress === 100 ? '重新校准' : isCalibrating ? '校准中...' : '开始校准' }}
              </el-button>

              <div v-if="meetingStore.calibrationParams" class="space-y-3">
                <h3 class="text-sm font-medium text-gray-300 mb-2">校准参数</h3>
                
                <div class="p-3 bg-dark-200 rounded-lg">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-sm text-gray-400">回声消除 (AEC)</span>
                    <span class="text-sm text-success font-medium">{{ meetingStore.calibrationParams.aecLevel.toFixed(1) }}%</span>
                  </div>
                  <el-progress 
                    :percentage="meetingStore.calibrationParams.aecLevel" 
                    :stroke-width="4"
                    color="#00B42A"
                  />
                </div>
                
                <div class="p-3 bg-dark-200 rounded-lg">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-sm text-gray-400">噪声抑制 (ANS)</span>
                    <span class="text-sm text-success font-medium">{{ meetingStore.calibrationParams.ansLevel.toFixed(1) }}%</span>
                  </div>
                  <el-progress 
                    :percentage="meetingStore.calibrationParams.ansLevel" 
                    :stroke-width="4"
                    color="#00B42A"
                  />
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="声纹锁" name="voicePrint">
            <div class="space-y-6">
              <div class="p-4 bg-dark-200 rounded-lg">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-sm font-medium text-gray-300">声纹锁开关</span>
                  <el-switch 
                    v-model="voicePrint.isVoiceLockEnabled"
                    active-color="#00B42A"
                    inactive-color="#4E5969"
                  />
                </div>
                <p class="text-xs text-gray-500">
                  {{ voicePrint.isVoiceLockEnabled 
                    ? '已启用 - 仅注册用户语音可传输' 
                    : '已禁用 - 所有语音均可传输' }}
                </p>
              </div>

              <div v-if="voicePrint.isVoiceLockEnabled" class="p-4 bg-primary/10 rounded-lg border border-primary/20">
                <h3 class="text-sm font-medium text-primary mb-3 flex items-center gap-2">
                  <el-icon><Lock /></el-icon>
                  实时声纹识别
                </h3>
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-400">匹配用户</span>
                    <span 
                      class="text-xs font-medium px-2 py-0.5 rounded"
                      :class="voicePrint.recognizedUser ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'"
                    >
                      {{ voicePrint.recognizedUser || '未识别' }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-400">匹配置信度</span>
                    <span class="text-xs text-primary font-medium">
                      {{ (voicePrint.lastResult.confidence * 100).toFixed(1) }}%
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-400">过滤状态</span>
                    <span 
                      class="text-xs font-medium"
                      :class="voicePrint.isFiltering ? 'text-warning' : 'text-success'"
                    >
                      {{ voicePrint.isFiltering ? '正在过滤非授权声源' : '正常传输' }}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3 class="text-sm font-medium text-gray-300 mb-3">注册新声纹</h3>
                <div class="space-y-3">
                  <el-input 
                    v-model="voicePrint.newUserName"
                    placeholder="输入用户名"
                    size="small"
                    class="custom-input"
                  />
                  <div>
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-xs text-gray-400">采样进度</span>
                      <span class="text-xs text-primary font-medium">{{ voicePrint.sampleProgress }}%</span>
                    </div>
                    <el-progress 
                      :percentage="voicePrint.sampleProgress" 
                      :stroke-width="6"
                      class="custom-progress"
                    />
                  </div>
                  <div class="flex gap-2">
                    <el-button 
                      type="primary" 
                      size="small"
                      class="flex-1"
                      :disabled="!isSpeaking || voicePrint.isCollectingSamples"
                      @click="startVoicePrintCollection"
                    >
                      {{ voicePrint.isCollectingSamples ? '采集中...' : '开始采集' }}
                    </el-button>
                    <el-button 
                      size="small"
                      @click="resetVoicePrintSamples"
                    >
                      重置
                    </el-button>
                  </div>
                  <el-button 
                    type="success" 
                    size="small"
                    class="w-full"
                    :disabled="voicePrint.sampleProgress < 100 || !voicePrint.newUserName"
                    @click="registerVoicePrint"
                  >
                    注册声纹
                  </el-button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-medium text-gray-300">
                    已注册声纹 ({{ voicePrint.registeredUsers.length }}/5)
                  </h3>
                  <el-button 
                    type="danger" 
                    size="small"
                    text
                    @click="clearAllVoicePrints"
                  >
                    清空
                  </el-button>
                </div>
                <div v-if="voicePrint.registeredUsers.length === 0" class="text-center py-6 text-gray-500 text-sm">
                  暂无注册声纹，请先采集并注册
                </div>
                <div v-else class="space-y-2">
                  <div 
                    v-for="user in voicePrint.registeredUsers" 
                    :key="user.id"
                    class="flex items-center justify-between p-3 bg-dark-200 rounded-lg"
                  >
                    <div class="flex items-center gap-2">
                      <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <el-icon class="text-primary text-sm"><User /></el-icon>
                      </div>
                      <div>
                        <p class="text-sm text-white font-medium">{{ user.name }}</p>
                        <p class="text-xs text-gray-500">
                          {{ new Date(user.registeredAt).toLocaleDateString() }}
                        </p>
                      </div>
                    </div>
                    <el-button 
                      type="danger" 
                      size="small"
                      text
                      @click="deleteVoicePrint(user.id)"
                    >
                      <el-icon><Delete /></el-icon>
                    </el-button>
                  </div>
                </div>
              </div>

              <div class="p-4 bg-warning/10 rounded-lg border border-warning/20">
                <h3 class="text-sm font-medium text-warning mb-2 flex items-center gap-2">
                  <el-icon><Warning /></el-icon>
                  使用说明
                </h3>
                <ul class="text-xs text-gray-400 space-y-1">
                  <li>• 最多可注册5位用户的声纹</li>
                  <li>• 采集时请保持环境安静，正常说话</li>
                  <li>• 启用声纹锁后，非注册用户声音将被过滤</li>
                  <li>• 背景噪音、电视声等会自动过滤</li>
                </ul>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </aside>
    </main>

    <footer class="px-6 py-4 border-t border-dark-300/30 bg-dark-200/50">
      <div class="flex items-center justify-center gap-4">
        <el-button 
          :type="meetingStore.isAudioEnabled ? '' : 'danger'"
          circle 
          size="large"
          class="w-14 h-14"
          @click="toggleAudioWithVoiceLock"
        >
          <el-icon class="text-xl">
            <Microphone v-if="meetingStore.isAudioEnabled && !voicePrint.isFiltering" />
            <Lock v-else-if="voicePrint.isFiltering" />
            <MicrophoneOff v-else />
          </el-icon>
        </el-button>

        <el-button 
          :type="meetingStore.isVideoEnabled ? '' : 'danger'"
          circle 
          size="large"
          class="w-14 h-14"
          @click="meetingStore.toggleVideo"
        >
          <el-icon class="text-xl">
            <VideoCamera v-if="meetingStore.isVideoEnabled" />
            <VideoCameraOff v-else />
          </el-icon>
        </el-button>

        <el-button 
          :type="voicePrint.isVoiceLockEnabled ? 'success' : 'default'"
          circle 
          size="large"
          class="w-14 h-14"
          @click="voicePrint.isVoiceLockEnabled = !voicePrint.isVoiceLockEnabled"
        >
          <el-icon class="text-xl">
            <Lock v-if="voicePrint.isVoiceLockEnabled" />
            <Unlock v-else />
          </el-icon>
        </el-button>

        <el-button 
          type="danger"
          circle 
          size="large"
          class="w-14 h-14"
          @click="leaveRoom"
        >
          <el-icon class="text-xl"><SwitchButton /></el-icon>
        </el-button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMeetingStore } from '@/stores/meeting'
import { AudioCalibrationService, type AudioFrameFeatures, type AudioClassificationResult } from '@/utils/audioCalibration'
import { voicePrintService, type VoicePrint } from '@/utils/voicePrintService'
import { idbService } from '@/utils/idb'
import { 
  ArrowLeft, Setting, SwitchButton, Microphone, MicrophoneOff,
  VideoCamera, VideoCameraOff, User, Check, TrendCharts, Lock,
  Unlock, Delete, Warning
} from '@element-plus/icons-vue'

const router = useRouter()
const meetingStore = useMeetingStore()

const localVideoRef = ref<HTMLVideoElement | null>(null)
const remoteVideoRefs = ref<Map<string, HTMLVideoElement>>(new Map())
const showCalibrationPanel = ref(true)
const isCalibrating = ref(false)
const calibrationProgress = ref(0)
const currentStep = ref<string>('idle')
const activeTab = ref('calibration')

const spectrumBars = ref<number[]>(new Array(32).fill(0.1))

const audioFeatures = ref<{
  voiceProbability: number
  noiseProbability: number
  confidence: number
  dominantSource: string
  detectedSpeakers: number
}>({
  voiceProbability: 0,
  noiseProbability: 0,
  confidence: 0,
  dominantSource: 'noise',
  detectedSpeakers: 0
})

const voicePrint = ref({
  isVoiceLockEnabled: false,
  newUserName: '',
  isCollectingSamples: false,
  sampleProgress: 0,
  registeredUsers: [] as VoicePrint[],
  recognizedUser: null as string | null,
  lastResult: { confidence: 0 },
  isFiltering: false
})

const isSpeaking = computed(() => audioFeatures.value.voiceProbability > 0.5)

let calibrationService: AudioCalibrationService | null = null
let stopRealtimeAnalysis: (() => void) | null = null

function setRemoteVideoRef(el: any, participantId: string) {
  if (el) {
    remoteVideoRefs.value.set(participantId, el)
  }
}

function toggleCalibrationPanel() {
  showCalibrationPanel.value = !showCalibrationPanel.value
}

function isVoiceAtBand(bandIndex: number): boolean {
  const voiceLowFreq = 300
  const voiceHighFreq = 3400
  const maxFreq = 24000
  const bandWidth = maxFreq / 32
  
  const bandLowFreq = bandIndex * bandWidth
  const bandHighFreq = (bandIndex + 1) * bandWidth
  
  return !(bandHighFreq < voiceLowFreq || bandLowFreq > voiceHighFreq)
}

function updateSpectrumVisualization(features: AudioFrameFeatures) {
  const maxEnergy = Math.max(...features.bandEnergy, 0.001)
  
  for (let i = 0; i < spectrumBars.value.length && i < features.bandEnergy.length; i++) {
    const targetHeight = Math.min(1, features.bandEnergy[i] / maxEnergy)
    spectrumBars.value[i] += (targetHeight - spectrumBars.value[i]) * 0.3
  }
}

function updateVoicePrintFeatures(features: AudioFrameFeatures) {
  const voiceFeature = voicePrintService.extractVoiceFeature(
    features.mfcc,
    features.bandEnergy,
    features.zeroCrossingRate,
    features.spectralCentroid
  )

  if (voicePrint.value.isCollectingSamples) {
    voicePrintService.collectSample(voiceFeature)
    voicePrint.value.sampleProgress = voicePrintService.getSampleProgress()
    
    if (voicePrint.value.sampleProgress >= 100) {
      voicePrint.value.isCollectingSamples = false
    }
  }

  if (voicePrint.value.isVoiceLockEnabled) {
    const result = voicePrintService.recognizeVoice(voiceFeature, meetingStore.roomId)
    voicePrint.value.lastResult = result
    voicePrint.value.recognizedUser = result.matchedUserName
    voicePrint.value.isFiltering = !result.recognized && result.isBackgroundNoise
  }
}

function resetVoicePrintSamples() {
  voicePrintService.resetCurrentSamples()
  voicePrint.value.sampleProgress = 0
  voicePrint.value.isCollectingSamples = false
}

function startVoicePrintCollection() {
  if (voicePrint.value.registeredUsers.length >= 5) {
    return
  }
  voicePrint.value.isCollectingSamples = true
  voicePrint.value.sampleProgress = 0
}

function registerVoicePrint() {
  if (!voicePrint.value.newUserName || voicePrint.value.sampleProgress < 100) {
    return
  }
  
  const vp = voicePrintService.registerVoicePrint(
    voicePrint.value.newUserName,
    meetingStore.roomId
  )
  
  if (vp) {
    voicePrint.value.registeredUsers.push(vp)
    voicePrint.value.newUserName = ''
    voicePrint.value.sampleProgress = 0
    voicePrintService.resetCurrentSamples()
  }
}

function deleteVoicePrint(id: string) {
  voicePrintService.deleteVoicePrint(id)
  voicePrint.value.registeredUsers = voicePrint.value.registeredUsers.filter(u => u.id !== id)
}

function clearAllVoicePrints() {
  voicePrintService.clearRoomVoicePrints(meetingStore.roomId)
  voicePrint.value.registeredUsers = []
  voicePrint.value.recognizedUser = null
}

function toggleAudioWithVoiceLock() {
  if (voicePrint.value.isVoiceLockEnabled && voicePrint.value.isFiltering) {
    return
  }
  meetingStore.toggleAudio()
}

async function initLocalStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    })
    meetingStore.setLocalStream(stream)
    if (localVideoRef.value) {
      localVideoRef.value.srcObject = stream
    }
  } catch (error) {
    console.error('Failed to access media devices:', error)
  }
}

async function startRealtimeAnalysis() {
  if (!calibrationService) {
    calibrationService = new AudioCalibrationService()
    await calibrationService.init()
  }
  
  stopRealtimeAnalysis = calibrationService.startRealtimeAnalysis(
    (features: AudioFrameFeatures, classification: AudioClassificationResult) => {
      updateSpectrumVisualization(features)
      updateVoicePrintFeatures(features)
      
      audioFeatures.value = {
        voiceProbability: classification.voiceProbability,
        noiseProbability: classification.noiseProbability,
        confidence: classification.confidence,
        dominantSource: classification.dominantSource,
        detectedSpeakers: meetingStore.calibrationParams?.detectedSpeakers || 0
      }
    }
  )
}

async function startCalibration() {
  if (isCalibrating.value) return
  
  isCalibrating.value = true
  calibrationProgress.value = 0
  
  try {
    if (!calibrationService) {
      calibrationService = new AudioCalibrationService()
    }
    
    const params = await calibrationService.calibrate(
      (step: string, progress: number) => {
        currentStep.value = step
        calibrationProgress.value = progress
      }
    )
    
    params.roomId = meetingStore.roomId
    params.userId = meetingStore.userId
    
    meetingStore.setCalibrationParams(params)
    await idbService.saveParams(params)
    
    audioFeatures.value.detectedSpeakers = params.detectedSpeakers || 0
    
    calibrationProgress.value = 100
    currentStep.value = 'complete'
  } catch (error) {
    console.error('Calibration failed:', error)
  } finally {
    isCalibrating.value = false
  }
}

function leaveRoom() {
  if (stopRealtimeAnalysis) {
    stopRealtimeAnalysis()
  }
  if (calibrationService) {
    calibrationService.cleanup()
  }
  if (meetingStore.localStream) {
    meetingStore.localStream.getTracks().forEach(track => track.stop())
  }
  meetingStore.resetMeeting()
  router.push('/')
}

watch(() => voicePrint.value.isVoiceLockEnabled, (enabled) => {
  if (!enabled) {
    voicePrint.value.recognizedUser = null
    voicePrint.value.isFiltering = false
  }
})

onMounted(async () => {
  await initLocalStream()
  await startRealtimeAnalysis()
  
  voicePrint.value.registeredUsers = voicePrintService.getVoicePrintsForRoom(meetingStore.roomId)
  
  const savedParams = await idbService.getLatestParams(
    meetingStore.roomId,
    meetingStore.userId
  )
  if (savedParams) {
    meetingStore.setCalibrationParams(savedParams)
    calibrationProgress.value = 100
    currentStep.value = 'complete'
    audioFeatures.value.detectedSpeakers = savedParams.detectedSpeakers || 0
  } else {
    setTimeout(() => {
      startCalibration()
    }, 1000)
  }
})

onUnmounted(() => {
  if (stopRealtimeAnalysis) {
    stopRealtimeAnalysis()
  }
  if (calibrationService) {
    calibrationService.cleanup()
  }
  if (meetingStore.localStream) {
    meetingStore.localStream.getTracks().forEach(track => track.stop())
  }
})
</script>

<style scoped>
.custom-progress :deep(.el-progress-bar__outer) {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.custom-progress :deep(.el-progress-bar__inner) {
  border-radius: 4px;
}

.dark-tabs :deep(.el-tabs__nav-wrap::after) {
  background: rgba(255, 255, 255, 0.1);
}

.dark-tabs :deep(.el-tabs__item) {
  color: #86909C;
}

.dark-tabs :deep(.el-tabs__item.is-active) {
  color: #165DFF;
}

.dark-tabs :deep(.el-tabs__active-bar) {
  background: #165DFF;
}

.custom-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: none;
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
