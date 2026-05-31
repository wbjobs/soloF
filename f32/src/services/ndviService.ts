import type { NDVIResult } from '../types';

type ProgressCallback = (progress: number) => void;

interface WorkerMessage {
  type: string;
  payload?: any;
  error?: string;
  progress?: number;
}

class NDVIWorkerService {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private progressCallback: ProgressCallback | null = null;

  async init(): Promise<void> {
    if (this.worker) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initWorker();
    return this.initPromise;
  }

  private async initWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(
          new URL('../workers/ndvi.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const { type, error, progress } = event.data;

          switch (type) {
            case 'INIT_SUCCESS':
              resolve();
              break;
            case 'PROGRESS':
              if (this.progressCallback && progress !== undefined) {
                this.progressCallback(progress);
              }
              break;
            case 'ERROR':
              reject(new Error(error || '未知错误'));
              break;
          }
        };

        this.worker.onerror = (error) => {
          reject(new Error(`Worker 错误: ${error.message}`));
        };

        this.worker.postMessage({ type: 'INIT' });
      } catch (error) {
        reject(error);
      }
    });
  }

  setProgressCallback(callback: ProgressCallback | null): void {
    this.progressCallback = callback;
  }

  async calculateNDVI(
    redBand: Float32Array,
    nirBand: Float32Array,
    width: number,
    height: number,
    useWasm: boolean = true
  ): Promise<NDVIResult> {
    await this.init();

    if (!this.worker) {
      throw new Error('Worker 未初始化');
    }

    return new Promise((resolve, reject) => {
      const messageHandler = (event: MessageEvent<WorkerMessage>) => {
        const { type, payload, error } = event.data;

        switch (type) {
          case 'CALCULATE_SUCCESS':
            if (this.worker) {
              this.worker.removeEventListener('message', messageHandler);
            }
            resolve(payload);
            break;
          case 'PROGRESS':
            if (this.progressCallback && event.data.progress !== undefined) {
              this.progressCallback(event.data.progress);
            }
            break;
          case 'ERROR':
            if (this.worker) {
              this.worker.removeEventListener('message', messageHandler);
            }
            reject(new Error(error || '计算失败'));
            break;
        }
      };

      this.worker!.addEventListener('message', messageHandler);

      const messageType = useWasm ? 'CALCULATE_NDVI' : 'CALCULATE_NDVI_JS';
      this.worker!.postMessage(
        {
          type: messageType,
          payload: {
            redBand,
            nirBand,
            width,
            height,
          },
        },
        [redBand.buffer, nirBand.buffer]
      );
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initPromise = null;
    }
  }
}

export const ndviWorkerService = new NDVIWorkerService();

export async function initWasm(): Promise<void> {
  try {
    await ndviWorkerService.init();
  } catch (error) {
    console.error('Failed to load WASM module:', error);
    throw new Error('WASM 模块加载失败，请先运行 npm run build-wasm');
  }
}

export function calculateNDVI(
  redBand: Float32Array,
  nirBand: Float32Array,
  width: number,
  height: number
): Promise<NDVIResult> {
  return ndviWorkerService.calculateNDVI(
    redBand.slice(),
    nirBand.slice(),
    width,
    height,
    true
  );
}

export function calculateNDVIJS(
  redBand: Float32Array,
  nirBand: Float32Array,
  width: number,
  height: number
): Promise<NDVIResult> {
  return ndviWorkerService.calculateNDVI(
    redBand.slice(),
    nirBand.slice(),
    width,
    height,
    false
  );
}
