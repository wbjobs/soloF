import { WebGPURenderer } from './renderer';
import { SceneDescription, HeatmapData, SingleHeatmapData } from './types';

let renderer: WebGPURenderer;
let isCalculating = false;
let lastHeatmapData: HeatmapData | null = null;

function setupUI(): void {
  const sphereReflectivity = document.getElementById('sphereReflectivity') as HTMLInputElement;
  const sphereRoughness = document.getElementById('sphereRoughness') as HTMLInputElement;
  const planeReflectivity = document.getElementById('planeReflectivity') as HTMLInputElement;
  const planeRoughness = document.getElementById('planeRoughness') as HTMLInputElement;
  const heatmapIntensity = document.getElementById('heatmapIntensity') as HTMLInputElement;
  const showHeatmap = document.getElementById('showHeatmap') as HTMLInputElement;
  const bounceSlider = document.getElementById('bounceSlider') as HTMLInputElement;
  const calculateBtn = document.getElementById('calculateBtn') as HTMLButtonElement;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

  const updateValue = (id: string, value: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  sphereReflectivity.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    renderer.sphereReflectivity = value;
    updateValue('sphereReflectivityValue', value.toFixed(2));
  });

  sphereRoughness.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    renderer.sphereRoughness = value;
    updateValue('sphereRoughnessValue', value.toFixed(2));
  });

  planeReflectivity.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    renderer.planeReflectivity = value;
    updateValue('planeReflectivityValue', value.toFixed(2));
  });

  planeRoughness.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    renderer.planeRoughness = value;
    updateValue('planeRoughnessValue', value.toFixed(2));
  });

  heatmapIntensity.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    renderer.heatmapIntensity = value;
    updateValue('heatmapIntensityValue', value.toFixed(1));
  });

  showHeatmap.addEventListener('change', (e) => {
    renderer.showHeatmap = (e.target as HTMLInputElement).checked;
  });

  bounceSlider.addEventListener('input', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    renderer.currentBounce = value;
    updateValue('bounceValue', value.toString());
    if (lastHeatmapData) {
      updateCurrentBounceTexture();
    }
  });

  calculateBtn.addEventListener('click', () => calculatePathTracing());
  exportBtn.addEventListener('click', () => exportToPNG());
}

function updateCurrentBounceTexture(): void {
  if (!lastHeatmapData || !lastHeatmapData.bounces[renderer.currentBounce]) return;
  
  const bounceData = lastHeatmapData.bounces[renderer.currentBounce];
  const singleData: SingleHeatmapData = {
    width: lastHeatmapData.width,
    height: lastHeatmapData.height,
    data: bounceData.data,
    maxBrightness: bounceData.maxBrightness
  };
  renderer.updateHeatmap(singleData);
}

function buildSceneDescription(): SceneDescription {
  const cameraPos = renderer.getCameraPosition();
  return {
    geometries: [
      {
        type: 'sphere',
        position: [0, 0, 0],
        radius: 1.0,
        material: {
          reflectivity: renderer.sphereReflectivity,
          roughness: renderer.sphereRoughness,
          color: [0.8, 0.3, 0.3]
        }
      },
      {
        type: 'plane',
        position: [0, -1, 0],
        normal: [0, 1, 0],
        material: {
          reflectivity: renderer.planeReflectivity,
          roughness: renderer.planeRoughness,
          color: [0.5, 0.5, 0.5]
        }
      }
    ],
    lights: [
      {
        position: [5, 5, 5],
        intensity: 100,
        color: [1, 1, 1]
      }
    ],
    resolution: { width: 256, height: 256 },
    samplesPerPixel: 10,
    camera: {
      position: [cameraPos[0], cameraPos[1], cameraPos[2]],
      target: [0, 0, 0],
      fov: Math.PI / 4
    }
  };
}

async function calculatePathTracing(): Promise<void> {
  if (isCalculating) return;
  
  isCalculating = true;
  const calculateBtn = document.getElementById('calculateBtn') as HTMLButtonElement;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;
  
  calculateBtn.disabled = true;
  exportBtn.disabled = true;
  statusEl.className = 'status loading';
  statusEl.textContent = '计算中 (0/3 张热力图)...';

  try {
    const scene = buildSceneDescription();
    
    const response = await fetch('/api/path-trace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(scene),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: HeatmapData = await response.json();
    lastHeatmapData = data;
    
    updateCurrentBounceTexture();
    
    statusEl.className = 'status';
    statusEl.textContent = data.cached ? '完成 (使用缓存)' : '完成 (3 张热力图)';
  } catch (error) {
    console.error('Path tracing error:', error);
    statusEl.className = 'status error';
    statusEl.textContent = `错误: ${(error as Error).message}`;
  } finally {
    isCalculating = false;
    calculateBtn.disabled = false;
    exportBtn.disabled = false;
  }
}

async function exportToPNG(): Promise<void> {
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;
  
  try {
    exportBtn.disabled = true;
    statusEl.className = 'status loading';
    statusEl.textContent = '导出中...';
    
    const dataUrl = await renderer.exportToPNG();
    
    const link = document.createElement('a');
    link.download = `path-trace-bounce-${renderer.currentBounce}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    
    statusEl.className = 'status';
    statusEl.textContent = '导出成功';
  } catch (error) {
    console.error('Export error:', error);
    statusEl.className = 'status error';
    statusEl.textContent = `导出失败: ${(error as Error).message}`;
  } finally {
    exportBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  
  renderer = new WebGPURenderer(canvas);
  await renderer.init();
  renderer.start();
  
  setupUI();
  
  const statusEl = document.getElementById('status') as HTMLDivElement;
  statusEl.textContent = '点击"计算路径追踪"开始';
}

init().catch((error) => {
  console.error('Initialization error:', error);
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = 'status error';
    statusEl.textContent = `初始化失败: ${error.message}`;
  }
});
