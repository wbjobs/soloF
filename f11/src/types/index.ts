export interface MatrixResult {
  success: boolean
  data?: number[]
  error?: string
}

export interface EigenResult {
  success: boolean
  eigenvalues?: number[]
  eigenvectors?: number[][]
  error?: string
}

export interface CalculationRecord {
  id: number
  type: string
  timestamp: number
  input: any
  result: any
}

export type Matrix4x4 = number[]
