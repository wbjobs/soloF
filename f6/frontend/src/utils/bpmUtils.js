export const medianFilter = (values, windowSize = 5) => {
  if (values.length < windowSize) return values
  const result = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2))
    const end = Math.min(values.length, i + Math.floor(windowSize / 2) + 1)
    const window = values.slice(start, end).sort((a, b) => a - b)
    const mid = Math.floor(window.length / 2)
    result.push(window.length % 2 === 1 ? window[mid] : (window[mid - 1] + window[mid]) / 2)
  }
  return result
}

export const removeOutliers = (values, threshold = 1.5) => {
  if (values.length < 4) return values
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length / 4)]
  const q3 = sorted[Math.floor(sorted.length * 3 / 4)]
  const iqr = q3 - q1
  const lowerBound = q1 - threshold * iqr
  const upperBound = q3 + threshold * iqr
  return values.filter((v) => v >= lowerBound && v <= upperBound)
}

export const calculateWeightedAverage = (values, decayFactor = 0.85) => {
  if (values.length === 0) return 0
  const weights = values.map((_, i) => Math.pow(decayFactor, values.length - 1 - i))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  return values.reduce((sum, value, i) => sum + value * weights[i], 0) / totalWeight
}

export const calculateEMA = (current, previous, alpha = 0.3) => {
  return previous + alpha * (current - previous)
}

export class KalmanFilter {
  constructor(processNoise = 0.001, measurementNoise = 0.1, estimationError = 1) {
    this.processNoise = processNoise
    this.measurementNoise = measurementNoise
    this.estimationError = estimationError
    this.estimate = null
  }

  update(measurement) {
    if (this.estimate === null) {
      this.estimate = measurement
      return this.estimate
    }

    this.estimationError += this.processNoise

    const kalmanGain = this.estimationError / (this.estimationError + this.measurementNoise)
    this.estimate += kalmanGain * (measurement - this.estimate)
    this.estimationError *= (1 - kalmanGain)

    return this.estimate
  }

  reset() {
    this.estimate = null
    this.estimationError = 1
  }
}

export class BpmSmoother {
  constructor(options = {}) {
    this.historySize = options.historySize || 20
    this.smoothingFactor = options.smoothingFactor || 0.25
    this.bpmHistory = []
    this.kalmanFilter = new KalmanFilter(0.0005, 0.05, 0.5)
    this.lastOutput = null
  }

  process(newBpm) {
    this.bpmHistory.push(newBpm)
    if (this.bpmHistory.length > this.historySize) {
      this.bpmHistory.shift()
    }

    if (this.bpmHistory.length < 3) {
      this.lastOutput = newBpm
      return newBpm
    }

    let processed = [...this.bpmHistory]

    processed = removeOutliers(processed, 2.0)

    if (processed.length >= 5) {
      processed = medianFilter(processed, 5)
    }

    const weightedAvg = calculateWeightedAverage(processed, 0.9)

    const kalmanFiltered = this.kalmanFilter.update(weightedAvg)

    if (this.lastOutput !== null) {
      const maxChange = 8
      const diff = kalmanFiltered - this.lastOutput
      if (Math.abs(diff) > maxChange) {
        this.lastOutput = this.lastOutput + Math.sign(diff) * maxChange
      } else {
        this.lastOutput = calculateEMA(kalmanFiltered, this.lastOutput, this.smoothingFactor)
      }
    } else {
      this.lastOutput = kalmanFiltered
    }

    return Math.round(Math.max(40, Math.min(300, this.lastOutput)))
  }

  reset() {
    this.bpmHistory = []
    this.kalmanFilter.reset()
    this.lastOutput = null
  }

  getConfidence() {
    if (this.bpmHistory.length < 5) return 0
    const filtered = removeOutliers(this.bpmHistory, 1.5)
    return Math.min(1, filtered.length / this.bpmHistory.length)
  }
}

export const intervalToBpm = (intervalMs) => {
  return Math.round(60000 / intervalMs)
}

export const bpmToInterval = (bpm) => {
  return 60000 / bpm
}
