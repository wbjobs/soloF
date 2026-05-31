import type { CalibrationParams, AudioClassificationResult } from '@/types'

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

export class AudioCalibrationService {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private mediaStream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  
  private recordedFrames: AudioFrameFeatures[] = []
  private isRecording: boolean = false
  
  private melFilterBank: number[][] = []
  private readonly VOICE_FREQ_LOW = 300
  private readonly VOICE_FREQ_HIGH = 3400
  private readonly NUM_MFCC_COEFFS = 13
  private readonly NUM_FREQ_BANDS = 32
  
  private noiseProfile: {
    floor: number
    spectralMean: number[]
    updateTime: number
  } | null = null
  
  private voiceModel: {
    meanEnergy: number
    meanSpectralCentroid: number
    confidence: number
  } = {
    meanEnergy: 0,
    meanSpectralCentroid: 0,
    confidence: 0
  }

  async init(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 48000 })
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.1
    
    this.initMelFilterBank()

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        }
      })
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.source.connect(this.analyser)
      
      this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1)
      this.source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)
    } catch (error) {
      console.error('Failed to access microphone:', error)
      throw error
    }
  }

  private initMelFilterBank(): void {
    const numFilters = 26
    const fftSize = 1024
    const sampleRate = 48000
    const melLow = this.freqToMel(this.VOICE_FREQ_LOW)
    const melHigh = this.freqToMel(this.VOICE_FREQ_HIGH)
    const melStep = (melHigh - melLow) / (numFilters + 1)
    
    this.melFilterBank = []
    
    for (let i = 0; i < numFilters; i++) {
      const filter: number[] = []
      const melCenter = melLow + melStep * (i + 1)
      const freqCenter = this.melToFreq(melCenter)
      const melLeft = melLow + melStep * i
      const melRight = melLow + melStep * (i + 2)
      const freqLeft = this.melToFreq(melLeft)
      const freqRight = this.melToFreq(melRight)
      
      for (let j = 0; j < fftSize / 2; j++) {
        const freq = (j * sampleRate) / fftSize
        if (freq < freqLeft || freq > freqRight) {
          filter.push(0)
        } else if (freq <= freqCenter) {
          filter.push((freq - freqLeft) / (freqCenter - freqLeft))
        } else {
          filter.push((freqRight - freq) / (freqRight - freqCenter))
        }
      }
      this.melFilterBank.push(filter)
    }
  }

  private freqToMel(freq: number): number {
    return 2595 * Math.log10(1 + freq / 700)
  }

  private melToFreq(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1)
  }

  private calculateZeroCrossingRate(timeData: Float32Array): number {
    let crossings = 0
    for (let i = 1; i < timeData.length; i++) {
      if ((timeData[i] >= 0 && timeData[i - 1] < 0) ||
          (timeData[i] < 0 && timeData[i - 1] >= 0)) {
        crossings++
      }
    }
    return crossings / timeData.length
  }

  private calculateEnergy(timeData: Float32Array): number {
    let sum = 0
    for (let i = 0; i < timeData.length; i++) {
      sum += timeData[i] * timeData[i]
    }
    return Math.sqrt(sum / timeData.length)
  }

  private calculateSpectralCentroid(freqData: Float32Array, sampleRate: number): number {
    let weightedSum = 0
    let sum = 0
    const fftSize = freqData.length * 2
    
    for (let i = 0; i < freqData.length; i++) {
      const freq = (i * sampleRate) / fftSize
      weightedSum += freq * freqData[i]
      sum += freqData[i]
    }
    
    return sum > 0 ? weightedSum / sum : 0
  }

  private calculateSpectralFlux(current: Float32Array, previous: Float32Array): number {
    let flux = 0
    for (let i = 0; i < current.length; i++) {
      flux += Math.abs(current[i] - previous[i])
    }
    return flux / current.length
  }

  private calculateBandEnergy(freqData: Float32Array, sampleRate: number): number[] {
    const bandEnergy: number[] = new Array(this.NUM_FREQ_BANDS).fill(0)
    const fftSize = freqData.length * 2
    const maxFreq = sampleRate / 2
    const bandWidth = maxFreq / this.NUM_FREQ_BANDS
    
    for (let i = 0; i < freqData.length; i++) {
      const freq = (i * sampleRate) / fftSize
      const bandIndex = Math.min(Math.floor(freq / bandWidth), this.NUM_FREQ_BANDS - 1)
      bandEnergy[bandIndex] += freqData[i] * freqData[i]
    }
    
    return bandEnergy.map(e => Math.sqrt(e))
  }

  private calculateMFCC(freqData: Float32Array): number[] {
    const melEnergies: number[] = []
    
    for (const filter of this.melFilterBank) {
      let energy = 0
      for (let i = 0; i < filter.length; i++) {
        energy += freqData[i] * freqData[i] * filter[i]
      }
      melEnergies.push(Math.log(energy + 1e-10))
    }
    
    const mfcc: number[] = []
    for (let i = 0; i < this.NUM_MFCC_COEFFS; i++) {
      let sum = 0
      for (let j = 0; j < melEnergies.length; j++) {
        sum += melEnergies[j] * Math.cos(i * (j + 0.5) * Math.PI / melEnergies.length)
      }
      mfcc.push(sum)
    }
    
    return mfcc
  }

  private detectSourceDirection(freqData: Float32Array, sampleRate: number): number {
    const bandDirections: number[] = []
    const fftSize = freqData.length * 2
    
    for (let band = 0; band < 8; band++) {
      const startIdx = Math.floor(band * freqData.length / 8)
      const endIdx = Math.floor((band + 1) * freqData.length / 8)
      
      let bandPeakIdx = startIdx
      let bandPeakVal = 0
      for (let i = startIdx; i < endIdx; i++) {
        if (freqData[i] > bandPeakVal) {
          bandPeakVal = freqData[i]
          bandPeakIdx = i
        }
      }
      
      const peakFreq = (bandPeakIdx * sampleRate) / fftSize
      if (peakFreq >= this.VOICE_FREQ_LOW && peakFreq <= this.VOICE_FREQ_HIGH) {
        bandDirections.push(peakFreq)
      }
    }
    
    if (bandDirections.length === 0) return 0
    
    return bandDirections.reduce((a, b) => a + b, 0) / bandDirections.length
  }

  classifyAudioFrame(
    features: AudioFrameFeatures,
    previousFeatures: AudioFrameFeatures | null
  ): AudioClassificationResult {
    const voiceBandStart = Math.floor(this.VOICE_FREQ_LOW / (24000 / this.NUM_FREQ_BANDS))
    const voiceBandEnd = Math.floor(this.VOICE_FREQ_HIGH / (24000 / this.NUM_FREQ_BANDS))
    
    const voiceBandEnergy = features.bandEnergy
      .slice(voiceBandStart, voiceBandEnd + 1)
      .reduce((a, b) => a + b, 0)
    
    const totalEnergy = features.bandEnergy.reduce((a, b) => a + b, 0)
    const voiceEnergyRatio = totalEnergy > 0 ? voiceBandEnergy / totalEnergy : 0
    
    const zcrScore = features.zeroCrossingRate < 0.1 ? 1 : 
                     features.zeroCrossingRate < 0.2 ? 0.5 : 0
    
    const spectralCentroidScore = 
      features.spectralCentroid >= this.VOICE_FREQ_LOW && 
      features.spectralCentroid <= this.VOICE_FREQ_HIGH ? 1 :
      features.spectralCentroid < this.VOICE_FREQ_LOW * 2 ? 0.5 : 0
    
    const energyScore = features.energy > 0.01 ? 1 : features.energy > 0.005 ? 0.5 : 0
    
    let temporalCorrelationScore = 0
    if (previousFeatures) {
      const mfccDistance = Math.sqrt(
        features.mfcc.reduce((sum, val, i) => 
          sum + Math.pow(val - previousFeatures.mfcc[i], 2), 0
        ) / features.mfcc.length
      )
      temporalCorrelationScore = mfccDistance < 0.5 ? 1 : mfccDistance < 1.0 ? 0.5 : 0
    }
    
    const fluxScore = features.spectralFlux < 0.1 ? 1 : 
                      features.spectralFlux < 0.3 ? 0.5 : 0
    
    const isVoiceScore = (
      voiceEnergyRatio * 0.3 +
      zcrScore * 0.2 +
      spectralCentroidScore * 0.2 +
      energyScore * 0.15 +
      temporalCorrelationScore * 0.1 +
      fluxScore * 0.05
    )
    
    const isNoiseScore = 1 - isVoiceScore
    
    return {
      isVoice: isVoiceScore > 0.5,
      isNoise: isNoiseScore > 0.5,
      voiceProbability: isVoiceScore,
      noiseProbability: isNoiseScore,
      confidence: Math.abs(isVoiceScore - 0.5) * 2,
      dominantSource: isVoiceScore > 0.5 ? 'voice' : 'noise',
      sourceDirection: features.sourceDirection
    }
  }

  updateNoiseProfile(features: AudioFrameFeatures, classification: AudioClassificationResult): void {
    if (classification.isNoise && classification.confidence > 0.7) {
      if (!this.noiseProfile) {
        this.noiseProfile = {
          floor: features.energy,
          spectralMean: [...features.bandEnergy],
          updateTime: Date.now()
        }
      } else {
        const alpha = 0.1
        this.noiseProfile.floor = alpha * features.energy + (1 - alpha) * this.noiseProfile.floor
        for (let i = 0; i < features.bandEnergy.length; i++) {
          this.noiseProfile.spectralMean[i] = 
            alpha * features.bandEnergy[i] + (1 - alpha) * this.noiseProfile.spectralMean[i]
        }
        this.noiseProfile.updateTime = Date.now()
      }
    }
  }

  extractFeatures(
    timeData: Float32Array,
    freqData: Float32Array,
    previousFeatures: AudioFrameFeatures | null
  ): AudioFrameFeatures {
    const sampleRate = this.audioContext?.sampleRate || 48000
    
    const energy = this.calculateEnergy(timeData)
    const zeroCrossingRate = this.calculateZeroCrossingRate(timeData)
    const spectralCentroid = this.calculateSpectralCentroid(freqData, sampleRate)
    const spectralFlux = previousFeatures ? 
      this.calculateSpectralFlux(freqData, new Float32Array(previousFeatures.bandEnergy)) : 0
    const mfcc = this.calculateMFCC(freqData)
    const bandEnergy = this.calculateBandEnergy(freqData, sampleRate)
    const sourceDirection = this.detectSourceDirection(freqData, sampleRate)
    
    const features: AudioFrameFeatures = {
      timestamp: Date.now(),
      energy,
      zeroCrossingRate,
      spectralCentroid,
      spectralFlux,
      mfcc,
      bandEnergy,
      isVoiceProbability: 0,
      sourceDirection
    }
    
    const classification = this.classifyAudioFrame(features, previousFeatures)
    features.isVoiceProbability = classification.voiceProbability
    
    this.updateNoiseProfile(features, classification)
    
    return features
  }

  async collectAmbientNoise(duration: number): Promise<void> {
    if (!this.analyser || !this.audioContext) return
    
    return new Promise((resolve) => {
      const bufferLength = this.analyser!.frequencyBinCount
      const timeData = new Float32Array(bufferLength)
      const freqData = new Float32Array(bufferLength)
      
      let framesCollected = 0
      const targetFrames = duration * 60
      
      const collectInterval = setInterval(() => {
        this.analyser!.getByteTimeDomainData(new Uint8Array(timeData.buffer))
        this.analyser!.getByteFrequencyData(new Uint8Array(freqData.buffer))
        
        for (let i = 0; i < timeData.length; i++) {
          timeData[i] = (timeData[i] - 128) / 128
          freqData[i] = freqData[i] / 255
        }
        
        const features = this.extractFeatures(
          timeData, 
          freqData, 
          this.recordedFrames.length > 0 ? this.recordedFrames[this.recordedFrames.length - 1] : null
        )
        
        this.recordedFrames.push(features)
        framesCollected++
        
        if (framesCollected >= targetFrames) {
          clearInterval(collectInterval)
          resolve()
        }
      }, 1000 / 60)
    })
  }

  generateSineWave(frequency: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioContext) {
        resolve()
        return
      }

      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()

      oscillator.frequency.value = frequency
      oscillator.type = 'sine'
      
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration)

      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)

      oscillator.start()
      oscillator.stop(this.audioContext.currentTime + duration)

      setTimeout(() => resolve(), duration * 1000)
    })
  }

  generatePinkNoise(duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioContext) {
        resolve()
        return
      }

      const bufferSize = this.audioContext.sampleRate * duration
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate)
      const data = buffer.getChannelData(0)

      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.1
        b6 = white * 0.115926
      }

      const noiseSource = this.audioContext.createBufferSource()
      noiseSource.buffer = buffer
      
      const gainNode = this.audioContext.createGain()
      gainNode.gain.value = 0.3

      noiseSource.connect(gainNode)
      gainNode.connect(this.audioContext.destination)

      noiseSource.start()
      
      setTimeout(() => resolve(), duration * 1000)
    })
  }

  generateSpeechLikeSound(duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioContext) {
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance('正在进行音频校准测试，请保持安静')
      utterance.lang = 'zh-CN'
      utterance.rate = 0.9
      utterance.pitch = 1
      utterance.volume = 0.5

      speechSynthesis.speak(utterance)
      
      setTimeout(() => resolve(), duration * 1000)
    })
  }

  calculateAdaptiveNoiseFloor(): { noiseFloor: number; voiceThreshold: number; dynamicThresholds: number[] } {
    if (this.recordedFrames.length === 0) {
      return { noiseFloor: -60, voiceThreshold: -40, dynamicThresholds: [] }
    }
    
    const noiseFrames = this.recordedFrames.filter(f => f.isVoiceProbability < 0.3)
    const voiceFrames = this.recordedFrames.filter(f => f.isVoiceProbability > 0.7)
    
    let noiseFloor = -60
    if (noiseFrames.length > 0) {
      const noiseEnergies = noiseFrames.map(f => f.energy)
      noiseEnergies.sort((a, b) => a - b)
      const medianNoise = noiseEnergies[Math.floor(noiseEnergies.length / 2)]
      noiseFloor = 20 * Math.log10(medianNoise + 1e-10)
    }
    
    let voiceThreshold = noiseFloor + 15
    if (voiceFrames.length > 0) {
      const voiceEnergies = voiceFrames.map(f => f.energy)
      voiceEnergies.sort((a, b) => a - b)
      const medianVoice = voiceEnergies[Math.floor(voiceEnergies.length / 2)]
      const voiceEnergyDb = 20 * Math.log10(medianVoice + 1e-10)
      voiceThreshold = (noiseFloor + voiceEnergyDb) / 2
    }
    
    const dynamicThresholds: number[] = []
    for (let band = 0; band < this.NUM_FREQ_BANDS; band++) {
      const bandNoiseEnergy = noiseFrames.reduce((sum, f) => sum + f.bandEnergy[band], 0) / noiseFrames.length
      const bandThreshold = 20 * Math.log10(bandNoiseEnergy + 1e-10) + 10
      dynamicThresholds.push(bandThreshold)
    }
    
    return { noiseFloor, voiceThreshold, dynamicThresholds }
  }

  calculateEchoMetricsWithNoiseSupression(): { delay: number; returnLoss: number; erle: number } {
    if (this.recordedFrames.length < 100) {
      return { delay: 20, returnLoss: 15, erle: 30 }
    }
    
    const voiceFrames = this.recordedFrames.filter(f => f.isVoiceProbability > 0.7)
    
    if (voiceFrames.length < 20) {
      return { delay: 25, returnLoss: 18, erle: 28 }
    }
    
    let erleEstimate = 0
    for (let i = 1; i < voiceFrames.length; i++) {
      const originalEnergy = voiceFrames[i - 1].energy
      const echoEnergy = Math.abs(voiceFrames[i].energy - originalEnergy * 0.1)
      if (echoEnergy > 0) {
        erleEstimate += 10 * Math.log10(originalEnergy / (echoEnergy + 1e-10))
      }
    }
    erleEstimate = erleEstimate / (voiceFrames.length - 1)
    
    const avgDelay = voiceFrames.reduce((sum, f) => sum + f.sourceDirection, 0) / voiceFrames.length
    
    return {
      delay: Math.max(10, Math.min(100, avgDelay / 100)),
      returnLoss: Math.max(10, Math.min(40, 20 + erleEstimate * 0.5)),
      erle: Math.max(20, Math.min(50, erleEstimate))
    }
  }

  detectMultipleSpeakers(): { count: number; confidence: number; directions: number[] } {
    if (this.recordedFrames.length < 50) {
      return { count: 1, confidence: 0.5, directions: [] }
    }
    
    const voiceFrames = this.recordedFrames.filter(f => f.isVoiceProbability > 0.6)
    if (voiceFrames.length < 20) {
      return { count: 1, confidence: 0.6, directions: [] }
    }
    
    const directions = voiceFrames.map(f => f.sourceDirection)
    
    const clusters: number[][] = []
    const clusterThreshold = 200
    
    for (const dir of directions) {
      let assigned = false
      for (const cluster of clusters) {
        const clusterMean = cluster.reduce((a, b) => a + b, 0) / cluster.length
        if (Math.abs(dir - clusterMean) < clusterThreshold) {
          cluster.push(dir)
          assigned = true
          break
        }
      }
      if (!assigned) {
        clusters.push([dir])
      }
    }
    
    const significantClusters = clusters.filter(c => c.length >= voiceFrames.length * 0.1)
    const speakerCount = Math.max(1, significantClusters.length)
    
    let confidence = 0.5
    if (speakerCount === 1) {
      confidence = significantClusters[0].length / voiceFrames.length
    } else {
      const clusterSizes = significantClusters.map(c => c.length).sort((a, b) => b - a)
      confidence = clusterSizes[0] / (clusterSizes[0] + (clusterSizes[1] || 0))
    }
    
    const clusterMeans = significantClusters.map(c => c.reduce((a, b) => a + b, 0) / c.length)
    
    return {
      count: speakerCount,
      confidence,
      directions: clusterMeans
    }
  }

  calculateOptimalANSLevel(noiseFloor: number, speakerCount: number): number {
    const baseLevel = 40
    
    const noiseAdjustment = Math.max(0, Math.min(30, (noiseFloor + 50) * 0.5))
    
    const speakerAdjustment = speakerCount > 1 ? 
      Math.max(0, 20 - speakerCount * 5) : 0
    
    return Math.min(100, Math.max(20, baseLevel + noiseAdjustment - speakerAdjustment))
  }

  calculateOptimalAECLevel(echoMetrics: { delay: number; returnLoss: number }, speakerCount: number): number {
    const baseLevel = 50
    
    const delayAdjustment = Math.min(30, echoMetrics.delay * 0.5)
    
    const lossAdjustment = Math.max(0, Math.min(20, echoMetrics.returnLoss * 0.5))
    
    const speakerAdjustment = speakerCount > 1 ? 10 : 0
    
    return Math.min(100, Math.max(30, baseLevel + delayAdjustment - lossAdjustment + speakerAdjustment))
  }

  async calibrate(
    onProgress: (step: string, progress: number) => void,
    onFeatures?: (features: AudioFrameFeatures[], classification: AudioClassificationResult[]) => void
  ): Promise<CalibrationParams> {
    await this.init()
    
    this.recordedFrames = []
    this.noiseProfile = null

    onProgress('ambient-noise', 5)
    await this.collectAmbientNoise(2)
    
    onProgress('sine-wave', 15)
    await this.generateSineWave(1000, 3)
    await this.collectAmbientNoise(0.5)
    
    onProgress('pink-noise', 45)
    await this.generatePinkNoise(3)
    await this.collectAmbientNoise(0.5)
    
    onProgress('speech', 75)
    await this.generateSpeechLikeSound(3)
    await this.collectAmbientNoise(1)
    
    onProgress('analysis', 90)
    await new Promise(resolve => setTimeout(resolve, 500))

    const { noiseFloor, voiceThreshold, dynamicThresholds } = this.calculateAdaptiveNoiseFloor()
    const echoMetrics = this.calculateEchoMetricsWithNoiseSupression()
    const speakerDetection = this.detectMultipleSpeakers()
    
    const ansLevel = this.calculateOptimalANSLevel(noiseFloor, speakerDetection.count)
    const aecLevel = this.calculateOptimalAECLevel(echoMetrics, speakerDetection.count)
    
    console.log('Calibration Results:', {
      noiseFloor,
      voiceThreshold,
      echoMetrics,
      speakerDetection,
      ansLevel,
      aecLevel
    })
    
    return {
      roomId: '',
      userId: '',
      timestamp: Date.now(),
      aecLevel,
      aecDelay: echoMetrics.delay,
      ansLevel,
      noiseFloor,
      echoReturnLoss: echoMetrics.returnLoss,
      roomImpulseResponse: dynamicThresholds,
      erleEstimate: echoMetrics.erle,
      detectedSpeakers: speakerDetection.count,
      speakerConfidence: speakerDetection.confidence,
      speakerDirections: speakerDetection.directions
    }
  }

  startRealtimeAnalysis(
    onFrame: (features: AudioFrameFeatures, classification: AudioClassificationResult) => void
  ): () => void {
    if (!this.analyser || !this.audioContext) {
      return () => {}
    }
    
    this.isRecording = true
    const bufferLength = this.analyser.frequencyBinCount
    const timeData = new Float32Array(bufferLength)
    const freqData = new Float32Array(bufferLength)
    let previousFeatures: AudioFrameFeatures | null = null
    
    const analyzeFrame = () => {
      if (!this.isRecording) return
      
      this.analyser!.getByteTimeDomainData(new Uint8Array(timeData.buffer))
      this.analyser!.getByteFrequencyData(new Uint8Array(freqData.buffer))
      
      for (let i = 0; i < timeData.length; i++) {
        timeData[i] = (timeData[i] - 128) / 128
        freqData[i] = freqData[i] / 255
      }
      
      const features = this.extractFeatures(timeData, freqData, previousFeatures)
      const classification = this.classifyAudioFrame(features, previousFeatures)
      
      previousFeatures = features
      
      onFrame(features, classification)
      
      requestAnimationFrame(analyzeFrame)
    }
    
    requestAnimationFrame(analyzeFrame)
    
    return () => {
      this.isRecording = false
    }
  }

  cleanup(): void {
    this.isRecording = false
    
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
    }
    if (this.source) {
      this.source.disconnect()
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
    }
    if (this.audioContext) {
      this.audioContext.close()
    }
    
    this.audioContext = null
    this.analyser = null
    this.mediaStream = null
    this.source = null
    this.scriptProcessor = null
    this.recordedFrames = []
  }
}
