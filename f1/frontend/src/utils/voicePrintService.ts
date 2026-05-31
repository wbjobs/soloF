import type { AudioFrameFeatures } from './audioCalibration'

export interface VoicePrint {
  id: string
  name: string
  roomId: string
  registeredAt: number
  featureVector: number[]
  sampleCount: number
  confidenceThreshold: number
  isHost: boolean
}

export interface VoiceRecognitionResult {
  recognized: boolean
  matchedUserId: string | null
  matchedUserName: string | null
  confidence: number
  isBackgroundNoise: boolean
}

export class VoicePrintService {
  private voicePrints: Map<string, VoicePrint> = new Map()
  private currentFeatures: number[][] = []
  private readonly MAX_SAMPLES_PER_USER = 50
  private readonly FEATURE_DIM = 26
  private readonly RECOGNITION_THRESHOLD = 0.75
  
  constructor() {
    this.loadFromStorage()
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('voicePrints')
      if (stored) {
        const data = JSON.parse(stored) as VoicePrint[]
        data.forEach(vp => this.voicePrints.set(vp.id, vp))
      }
    } catch (e) {
      console.error('Failed to load voice prints:', e)
    }
  }

  private saveToStorage(): void {
    try {
      const data = Array.from(this.voicePrints.values())
      localStorage.setItem('voicePrints', JSON.stringify(data))
    } catch (e) {
      console.error('Failed to save voice prints:', e)
    }
  }

  extractVoiceFeature(
    mfcc: number[],
    bandEnergy: number[],
    zeroCrossingRate: number,
    spectralCentroid: number
  ): number[] {
    const feature: number[] = []
    
    for (let i = 0; i < Math.min(13, mfcc.length); i++) {
      feature.push(mfcc[i] || 0)
    }
    
    const energySum = bandEnergy.reduce((a, b) => a + b, 0)
    for (let i = 0; i < 8; i++) {
      feature.push((bandEnergy[i] || 0) / (energySum || 1))
    }
    
    feature.push(zeroCrossingRate)
    feature.push(spectralCentroid / 10000)
    
    const deltaEnergy = 0
    feature.push(deltaEnergy)
    
    for (let i = feature.length; i < this.FEATURE_DIM; i++) {
      feature.push(0)
    }
    
    return feature.slice(0, this.FEATURE_DIM)
  }

  private normalizeVector(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0))
    if (norm === 0) return v
    return v.map(val => val / norm)
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    const n1 = this.normalizeVector(v1)
    const n2 = this.normalizeVector(v2)
    
    let dotProduct = 0
    for (let i = 0; i < Math.min(n1.length, n2.length); i++) {
      dotProduct += n1[i] * n2[i]
    }
    
    return dotProduct
  }

  private euclideanDistance(v1: number[], v2: number[]): number {
    let sum = 0
    for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
      const diff = v1[i] - v2[i]
      sum += diff * diff
    }
    return Math.sqrt(sum)
  }

  collectSample(feature: number[]): void {
    this.currentFeatures.push(feature)
    if (this.currentFeatures.length > this.MAX_SAMPLES_PER_USER) {
      this.currentFeatures.shift()
    }
  }

  registerVoicePrint(
    name: string,
    roomId: string,
    isHost: boolean = false
  ): VoicePrint | null {
    if (this.currentFeatures.length < 10) {
      console.warn('Not enough samples to register voice print')
      return null
    }
    
    const avgFeature = new Array(this.FEATURE_DIM).fill(0)
    for (const f of this.currentFeatures) {
      for (let i = 0; i < f.length; i++) {
        avgFeature[i] += f[i]
      }
    }
    for (let i = 0; i < avgFeature.length; i++) {
      avgFeature[i] /= this.currentFeatures.length
    }
    
    const voicePrint: VoicePrint = {
      id: 'vp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name,
      roomId,
      registeredAt: Date.now(),
      featureVector: avgFeature,
      sampleCount: this.currentFeatures.length,
      confidenceThreshold: this.RECOGNITION_THRESHOLD,
      isHost
    }
    
    this.voicePrints.set(voicePrint.id, voicePrint)
    this.saveToStorage()
    this.currentFeatures = []
    
    return voicePrint
  }

  recognizeVoice(
    feature: number[],
    roomId: string
  ): VoiceRecognitionResult {
    const roomPrints = Array.from(this.voicePrints.values())
      .filter(vp => vp.roomId === roomId)
    
    if (roomPrints.length === 0) {
      return {
        recognized: false,
        matchedUserId: null,
        matchedUserName: null,
        confidence: 0,
        isBackgroundNoise: true
      }
    }
    
    let bestMatch: VoicePrint | null = null
    let bestScore = 0
    
    for (const vp of roomPrints) {
      const similarity = this.cosineSimilarity(feature, vp.featureVector)
      const distance = this.euclideanDistance(feature, vp.featureVector)
      const score = similarity * (1 / (1 + distance * 0.5))
      
      if (score > bestScore) {
        bestScore = score
        bestMatch = vp
      }
    }
    
    const isBackgroundNoise = bestScore < 0.3
    
    if (bestMatch && bestScore >= bestMatch.confidenceThreshold) {
      return {
        recognized: true,
        matchedUserId: bestMatch.id,
        matchedUserName: bestMatch.name,
        confidence: bestScore,
        isBackgroundNoise
      }
    }
    
    return {
      recognized: false,
      matchedUserId: null,
      matchedUserName: null,
      confidence: bestScore,
      isBackgroundNoise
    }
  }

  getVoicePrintsForRoom(roomId: string): VoicePrint[] {
    return Array.from(this.voicePrints.values())
      .filter(vp => vp.roomId === roomId)
  }

  deleteVoicePrint(id: string): boolean {
    const result = this.voicePrints.delete(id)
    if (result) {
      this.saveToStorage()
    }
    return result
  }

  clearRoomVoicePrints(roomId: string): void {
    const toDelete = Array.from(this.voicePrints.values())
      .filter(vp => vp.roomId === roomId)
      .map(vp => vp.id)
    
    toDelete.forEach(id => this.voicePrints.delete(id))
    this.saveToStorage()
  }

  getRegisteredCount(roomId: string): number {
    return Array.from(this.voicePrints.values())
      .filter(vp => vp.roomId === roomId).length
  }

  isSampleCollectionReady(): boolean {
    return this.currentFeatures.length >= 10
  }

  getSampleProgress(): number {
    return Math.min(100, (this.currentFeatures.length / 10) * 100)
  }

  resetCurrentSamples(): void {
    this.currentFeatures = []
  }
}

export const voicePrintService = new VoicePrintService()
