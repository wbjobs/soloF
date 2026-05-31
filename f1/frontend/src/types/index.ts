export interface Participant {
  id: string
  name: string
  isAudioEnabled: boolean
  isVideoEnabled: boolean
  stream?: MediaStream
}

export interface AudioClassificationResult {
  isVoice: boolean
  isNoise: boolean
  voiceProbability: number
  noiseProbability: number
  confidence: number
  dominantSource: 'voice' | 'noise'
  sourceDirection: number
}

export interface CalibrationParams {
  id?: number
  roomId: string
  userId: string
  timestamp: number
  aecLevel: number
  aecDelay: number
  ansLevel: number
  noiseFloor: number
  echoReturnLoss: number
  roomImpulseResponse: number[]
  erleEstimate?: number
  detectedSpeakers?: number
  speakerConfidence?: number
  speakerDirections?: number[]
}

export interface RoomState {
  roomId: string
  roomName: string
  createdAt: number
  participants: {
    [userId: string]: {
      name: string
      isAudioEnabled: boolean
      isVideoEnabled: boolean
      joinedAt: number
    }
  }
}

export type CalibrationStep = 'idle' | 'ambient-noise' | 'sine-wave' | 'pink-noise' | 'speech' | 'analysis' | 'complete'

export interface AudioFrameFeatures {
  timestamp: number
  energy: number
  zeroCrossingRate: number
  spectralCentroid: number
  spectralFlux: number
  mfcc: number[]
  bandEnergy: number[]
  isVoiceProbability: number
  sourceDirection: number
}
