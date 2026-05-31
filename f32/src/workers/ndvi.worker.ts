/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope;

interface WasmModule {
  default: () => Promise<void>;
  calculate_ndvi: (red: Float32Array, nir: Float32Array) => Float32Array;
  calculate_ndvi_parallel: (red: Float32Array, nir: Float32Array) => Float32Array;
  calculate_ndvi_fast: (red: number, nir: number, len: number) => number;
  free_ndvi_result: (ptr: number, len: number) => void;
  set_cancel_flag: (cancel: boolean) => void;
}

let wasmModule: WasmModule | null = null;
let initPromise: Promise<void> | null = null;

async function initWasm(): Promise<void> {
  if (wasmModule) return;
  if (initPromise) return initPromise;

  try {
    initPromise = (async () => {
      const module = await import('@ndvi-wasm') as WasmModule;
      await module.default();
      wasmModule = module;
    })();
    await initPromise;
  } catch (error) {
    console.error('Worker: WASM 初始化失败:', error);
    throw error;
  }
}

function calculateStats(data: Float32Array): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const length = data.length;
  const batchSize = 100000;

  for (let i = 0; i < length; i++) {
    const value = data[i];
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;

    if (i % batchSize === 0 && i > 0) {
      self.postMessage({
        type: 'progress',
        progress: Math.round((i / length) * 100),
      });
    }
  }

  const mean = sum / length;
  return { min, max, mean };
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      try {
        await initWasm();
        self.postMessage({ type: 'INIT_SUCCESS' });
      } catch (error) {
        self.postMessage({
          type: 'ERROR',
          error: error instanceof Error ? error.message : 'WASM 初始化失败',
        });
      }
      break;

    case 'CANCEL':
      if (wasmModule) {
        wasmModule.set_cancel_flag(true);
      }
      break;

    case 'CALCULATE_NDVI': {
      const { redBand, nirBand, width, height } = payload;

      try {
        await initWasm();

        if (!wasmModule) {
          throw new Error('WASM 模块未初始化');
        }

        wasmModule.set_cancel_flag(false);

        self.postMessage({ type: 'PROGRESS', progress: 10 });

        const ndviData = wasmModule.calculate_ndvi(redBand, nirBand);

        self.postMessage({ type: 'PROGRESS', progress: 80 });

        const stats = calculateStats(ndviData);

        self.postMessage({
          type: 'CALCULATE_SUCCESS',
          payload: {
            data: ndviData,
            width,
            height,
            ...stats,
          },
        }, [ndviData.buffer]);

      } catch (error) {
        self.postMessage({
          type: 'ERROR',
          error: error instanceof Error ? error.message : 'NDVI 计算失败',
        });
      }
      break;
    }

    case 'CALCULATE_NDVI_JS': {
      const { redBand, nirBand, width, height } = payload;

      try {
        self.postMessage({ type: 'PROGRESS', progress: 10 });

        const ndviData = new Float32Array(redBand.length);
        const length = redBand.length;
        const batchSize = 100000;

        for (let i = 0; i < length; i++) {
          const r = redBand[i];
          const n = nirBand[i];
          if (r + n === 0) {
            ndviData[i] = 0;
          } else {
            ndviData[i] = (n - r) / (n + r);
          }

          if (i % batchSize === 0 && i > 0) {
            self.postMessage({
              type: 'PROGRESS',
              progress: 10 + Math.round((i / length) * 70),
            });
          }
        }

        self.postMessage({ type: 'PROGRESS', progress: 85 });

        const stats = calculateStats(ndviData);

        self.postMessage({
          type: 'CALCULATE_SUCCESS',
          payload: {
            data: ndviData,
            width,
            height,
            ...stats,
          },
        }, [ndviData.buffer]);

      } catch (error) {
        self.postMessage({
          type: 'ERROR',
          error: error instanceof Error ? error.message : 'NDVI 计算失败',
        });
      }
      break;
    }
  }
};

export {};
