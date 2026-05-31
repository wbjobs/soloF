import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Participant, CalibrationParams, CalibrationStep } from '@/types'

export const useMeetingStore = defineStore('meeting', () => {
  const roomId = ref<string>('')
  const roomName = ref<string>('')
  const userName = ref<string>('')
  const userId = ref<string>('')
  
  const localStream = ref<MediaStream | null>(null)
  const participants = ref<Participant[]>([])
  
  const isAudioEnabled = ref(true)
  const isVideoEnabled = ref(true)
  
  const calibrationStep = ref<CalibrationStep>('idle')
  const calibrationProgress = ref(0)
  const calibrationParams = ref<CalibrationParams | null>(null)
  const isCalibrationEnabled = ref(true)
  
  const participantList = computed(() => participants.value)
  const isInRoom = computed(() => !!roomId.value)
  
  function setUserInfo(name: string) {
    userName.value = name
    userId.value = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  function setRoomInfo(id: string, name: string) {
    roomId.value = id
    roomName.value = name
  }
  
  function setLocalStream(stream: MediaStream) {
    localStream.value = stream
  }
  
  function addParticipant(participant: Participant) {
    const existing = participants.value.find(p => p.id === participant.id)
    if (!existing) {
      participants.value.push(participant)
    }
  }
  
  function removeParticipant(participantId: string) {
    const index = participants.value.findIndex(p => p.id === participantId)
    if (index !== -1) {
      participants.value.splice(index, 1)
    }
  }
  
  function updateParticipant(participantId: string, updates: Partial<Participant>) {
    const participant = participants.value.find(p => p.id === participantId)
    if (participant) {
      Object.assign(participant, updates)
    }
  }
  
  function toggleAudio() {
    isAudioEnabled.value = !isAudioEnabled.value
    if (localStream.value) {
      localStream.value.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled.value
      })
    }
  }
  
  function toggleVideo() {
    isVideoEnabled.value = !isVideoEnabled.value
    if (localStream.value) {
      localStream.value.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled.value
      })
    }
  }
  
  function setCalibrationStep(step: CalibrationStep) {
    calibrationStep.value = step
  }
  
  function setCalibrationProgress(progress: number) {
    calibrationProgress.value = progress
  }
  
  function setCalibrationParams(params: CalibrationParams) {
    calibrationParams.value = params
  }
  
  function toggleCalibration() {
    isCalibrationEnabled.value = !isCalibrationEnabled.value
  }
  
  function resetMeeting() {
    roomId.value = ''
    roomName.value = ''
    participants.value = []
    localStream.value = null
    calibrationStep.value = 'idle'
    calibrationProgress.value = 0
  }
  
  return {
    roomId,
    roomName,
    userName,
    userId,
    localStream,
    participants,
    isAudioEnabled,
    isVideoEnabled,
    calibrationStep,
    calibrationProgress,
    calibrationParams,
    isCalibrationEnabled,
    participantList,
    isInRoom,
    setUserInfo,
    setRoomInfo,
    setLocalStream,
    addParticipant,
    removeParticipant,
    updateParticipant,
    toggleAudio,
    toggleVideo,
    setCalibrationStep,
    setCalibrationProgress,
    setCalibrationParams,
    toggleCalibration,
    resetMeeting
  }
})
