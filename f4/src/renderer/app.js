import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { aiModelManager } from './ai-model-manager.js';

const { RenderingEngine, Enums, volumeLoader, imageLoader, utilities, cache } = cornerstone;
const { ViewportType } = Enums;

let aiGeneratedContour = null;
let aiMaskCanvas = null;

let renderingEngine;
let volume;
let currentCaseId = null;
let contourMode = false;
let currentContourPoints = [];
let savedContours = [];
let currentView = 'axial';
let vtkColorTransferFunction = null;
let vtkPiecewiseFunction = null;

const viewportIds = {
  axial: 'axialViewport',
  coronal: 'coronalViewport',
  sagittal: 'sagittalViewport',
  volume: 'volumeViewport'
};

async function initCornerstone() {
  await cornerstone.init();
  
  const { StreamingImageVolumeLoader } = await import('@cornerstonejs/streaming-image-volume-loader');
  volumeLoader.registerVolumeLoader('cornerstoneStreamingImageVolume', new StreamingImageVolumeLoader());
  
  renderingEngine = new RenderingEngine('dicom-rendering-engine');
}

function cleanupVtkResources() {
  try {
    if (vtkColorTransferFunction) {
      vtkColorTransferFunction.delete();
      vtkColorTransferFunction = null;
    }
    if (vtkPiecewiseFunction) {
      vtkPiecewiseFunction.delete();
      vtkPiecewiseFunction = null;
    }
  } catch (e) {
    console.warn('清理vtk资源时警告:', e);
  }
}

function cleanupCornerstoneCache() {
  try {
    if (volume) {
      const volumeId = volume.volumeId;
      if (volumeId && cache.isVolumeLoaded(volumeId)) {
        cache.removeVolumeLoadObject(volumeId);
      }
      
      if (volume.imageData) {
        volume.imageData = null;
      }
      if (volume.vtkOpenGLTexture) {
        volume.vtkOpenGLTexture = null;
      }
      
      volume = null;
    }
    
    const imageCacheInfo = cache.getImageCacheInfo();
    if (imageCacheInfo && imageCacheInfo.loaded > 0) {
      cache.purgeImageCache();
    }
  } catch (e) {
    console.warn('清理Cornerstone缓存时警告:', e);
  }
}

function cleanupViewports() {
  try {
    if (renderingEngine) {
      Object.values(viewportIds).forEach(viewportId => {
        try {
          const viewport = renderingEngine.getViewport(viewportId);
          if (viewport) {
            if (viewport.clearViewports) {
              viewport.clearViewports();
            }
            if (viewport.removeAllActors) {
              viewport.removeAllActors();
            }
            if (viewport.resetCamera) {
              viewport.resetCamera();
            }
          }
        } catch (e) {
        }
      });
    }
  } catch (e) {
    console.warn('清理视口时警告:', e);
  }
}

function cleanupContourCanvases() {
  try {
    Object.values(viewportIds).forEach(viewportId => {
      const viewportElement = document.getElementById(viewportId);
      if (viewportElement) {
        const canvases = viewportElement.querySelectorAll('.contour-canvas');
        canvases.forEach(canvas => {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
          canvas.remove();
        });
      }
    });
  } catch (e) {
    console.warn('清理轮廓画布时警告:', e);
  }
}

function cleanupContourMode() {
  if (contourMode) {
    stopContourMode();
  }
  currentContourPoints = [];
  savedContours = [];
}

function forceGC() {
  try {
    if (window.gc) {
      window.gc();
    }
    if (window.CollectGarbage) {
      window.CollectGarbage();
    }
    if (window.electronAPI && window.electronAPI.forceGC) {
      window.electronAPI.forceGC();
    }
  } catch (e) {
  }
}

function cleanupAllResources() {
  cleanupContourMode();
  cleanupContourCanvases();
  cleanupVtkResources();
  cleanupViewports();
  cleanupCornerstoneCache();
  cleanupAIResources();
  forceGC();
}

function cleanupAIResources() {
  aiGeneratedContour = null;
  if (aiMaskCanvas) {
    aiMaskCanvas.remove();
    aiMaskCanvas = null;
  }
  document.getElementById('aiResults').style.display = 'none';
}

async function loadAIModel() {
  const statusIndicator = document.getElementById('aiStatusIndicator');
  const statusText = document.getElementById('aiStatusText');
  const loadBtn = document.getElementById('loadModelBtn');
  const segmentBtn = document.getElementById('aiSegmentBtn');
  
  statusIndicator.textContent = '⏳';
  statusIndicator.className = 'ai-status-indicator loading';
  statusText.textContent = '正在加载模型...';
  loadBtn.disabled = true;
  
  try {
    const loaded = await aiModelManager.loadModel();
    
    if (loaded) {
      statusIndicator.textContent = '✅';
      statusIndicator.className = 'ai-status-indicator ready';
      statusText.textContent = '模型已就绪';
      loadBtn.textContent = '重新加载';
      loadBtn.disabled = false;
      segmentBtn.disabled = !volume;
    } else {
      statusIndicator.textContent = '⚠️';
      statusIndicator.className = 'ai-status-indicator';
      statusText.textContent = '模拟模式（无模型文件）';
      loadBtn.textContent = '重新加载';
      loadBtn.disabled = false;
      segmentBtn.disabled = !volume;
    }
  } catch (error) {
    statusIndicator.textContent = '❌';
    statusIndicator.className = 'ai-status-indicator error';
    statusText.textContent = '加载失败: ' + error.message;
    loadBtn.disabled = false;
  }
}

function getCurrentSliceData(viewType) {
  if (!volume || !volume.voxelManager) {
    return null;
  }
  
  const dimensions = volume.dimensions;
  const spacing = volume.spacing || [1, 1, 1];
  const voxelManager = volume.voxelManager;
  
  let width, height, sliceData;
  
  switch (viewType) {
    case 'axial':
      width = dimensions[0];
      height = dimensions[1];
      const axialSlider = document.getElementById('axialSlider');
      const z = parseInt(axialSlider.value) || Math.floor(dimensions[2] / 2);
      sliceData = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = z * dimensions[0] * dimensions[1] + y * dimensions[0] + x;
          sliceData[y * width + x] = voxelManager.getVoxel(offset);
        }
      }
      break;
    case 'coronal':
      width = dimensions[0];
      height = dimensions[2];
      const coronalSlider = document.getElementById('coronalSlider');
      const yCor = parseInt(coronalSlider.value) || Math.floor(dimensions[1] / 2);
      sliceData = new Float32Array(width * height);
      for (let z = 0; z < dimensions[2]; z++) {
        for (let x = 0; x < width; x++) {
          const offset = z * dimensions[0] * dimensions[1] + yCor * dimensions[0] + x;
          sliceData[z * width + x] = voxelManager.getVoxel(offset);
        }
      }
      break;
    case 'sagittal':
      width = dimensions[1];
      height = dimensions[2];
      const sagittalSlider = document.getElementById('sagittalSlider');
      const xSag = parseInt(sagittalSlider.value) || Math.floor(dimensions[0] / 2);
      sliceData = new Float32Array(width * height);
      for (let z = 0; z < dimensions[2]; z++) {
        for (let y = 0; y < dimensions[1]; y++) {
          const offset = z * dimensions[0] * dimensions[1] + y * dimensions[0] + xSag;
          sliceData[z * width + y] = voxelManager.getVoxel(offset);
        }
      }
      break;
    default:
      return null;
  }
  
  return { data: sliceData, width, height, spacing };
}

async function runAISegmentation() {
  if (!volume) {
    alert('请先加载DICOM数据');
    return;
  }
  
  const segmentBtn = document.getElementById('aiSegmentBtn');
  const progressDiv = document.getElementById('aiProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const resultsDiv = document.getElementById('aiResults');
  
  segmentBtn.disabled = true;
  progressDiv.style.display = 'block';
  resultsDiv.style.display = 'none';
  
  try {
    progressFill.style.width = '20%';
    progressText.textContent = '提取图像数据...';
    await new Promise(r => setTimeout(r, 100));
    
    const sliceInfo = getCurrentSliceData(currentView);
    if (!sliceInfo) {
      throw new Error('无法获取切片数据');
    }
    
    progressFill.style.width = '40%';
    progressText.textContent = '图像预处理...';
    await new Promise(r => setTimeout(r, 100));
    
    aiModelManager.setWindowLevel(
      parseInt(document.getElementById('windowWidth').value),
      parseInt(document.getElementById('windowCenter').value)
    );
    
    progressFill.style.width = '60%';
    progressText.textContent = 'AI模型推理...';
    await new Promise(r => setTimeout(r, 100));
    
    const { mask, contourPoints } = await aiModelManager.segmentSlice(
      sliceInfo.data,
      sliceInfo.width,
      sliceInfo.height
    );
    
    progressFill.style.width = '80%';
    progressText.textContent = '生成轮廓...';
    await new Promise(r => setTimeout(r, 100));
    
    if (contourPoints.length < 3) {
      throw new Error('未检测到有效的分割区域');
    }
    
    aiGeneratedContour = {
      points: contourPoints,
      mask: mask,
      viewType: currentView,
      width: sliceInfo.width,
      height: sliceInfo.height,
      spacing: sliceInfo.spacing
    };
    
    drawAIContour(contourPoints, mask, sliceInfo.width, sliceInfo.height);
    
    const area = calculatePolygonArea(contourPoints) * sliceInfo.spacing[0] * sliceInfo.spacing[1];
    
    document.getElementById('aiPointCount').textContent = contourPoints.length;
    document.getElementById('aiArea').textContent = area.toFixed(2);
    resultsDiv.style.display = 'block';
    
    progressFill.style.width = '100%';
    progressText.textContent = '分割完成！';
    
    setTimeout(() => {
      progressDiv.style.display = 'none';
      progressFill.style.width = '0%';
    }, 500);
    
  } catch (error) {
    console.error('AI分割失败:', error);
    alert('AI分割失败: ' + error.message);
    progressDiv.style.display = 'none';
  } finally {
    segmentBtn.disabled = false;
  }
}

function drawAIContour(points, mask, width, height) {
  const viewportElement = document.getElementById(viewportIds[currentView]);
  let canvas = viewportElement.querySelector('.ai-mask-canvas');
  
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'ai-mask-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    viewportElement.appendChild(canvas);
  }
  
  canvas.width = viewportElement.clientWidth;
  canvas.height = viewportElement.clientHeight;
  aiMaskCanvas = canvas;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const scaleX = canvas.width / width;
  const scaleY = canvas.height / height;
  
  ctx.fillStyle = 'rgba(0, 212, 255, 0.3)';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        ctx.fillRect(
          x * scaleX,
          y * scaleY,
          Math.max(1, scaleX),
          Math.max(1, scaleY)
        );
      }
    }
  }
  
  if (points.length > 0) {
    ctx.beginPath();
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 10;
    
    ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
    }
    ctx.closePath();
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = index === 0 ? '#28a745' : '#00d4ff';
      ctx.arc(point.x * scaleX, point.y * scaleY, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function acceptAIContour() {
  if (!aiGeneratedContour) return;
  
  currentContourPoints = aiGeneratedContour.points.map(p => ({ ...p }));
  document.getElementById('pointCount').textContent = currentContourPoints.length;
  drawContour();
  
  cleanupAIResources();
  alert('AI轮廓已接受，您可以继续微调或直接保存！');
}

function refineAIContour() {
  if (!aiGeneratedContour) return;
  
  currentContourPoints = aiGeneratedContour.points.map(p => ({ ...p }));
  document.getElementById('pointCount').textContent = currentContourPoints.length;
  
  cleanupAIResources();
  
  if (!contourMode) {
    startContourMode(currentView);
  }
  
  drawContour();
  alert('进入微调模式，您可以点击添加新点或使用撤销功能');
}

function rejectAIContour() {
  cleanupAIResources();
  document.getElementById('aiSegmentBtn').disabled = false;
}

async function loadDicomFolder(folderPath) {
  try {
    cleanupAllResources();
    
    const dicomFiles = await window.electronAPI.getDicomFiles(folderPath);
    if (dicomFiles.length === 0) {
      alert('未找到DICOM文件');
      return;
    }
    
    const imageIds = dicomFiles.map((file, index) => {
      return `dicom://${Date.now()}-${index}`;
    });
    
    const volumeId = `cornerstoneStreamingImageVolume:volume-${Date.now()}`;
    const definition = {
      volumeId,
      imageIds,
      loader: 'cornerstoneStreamingImageVolume'
    };
    
    volume = await volumeLoader.createAndCacheVolume(definition, { imageIds });
    
    setupViewports();
    
    document.getElementById('patientInfo').textContent = `加载中...`;
    
    setTimeout(async () => {
      await saveCase(folderPath, dicomFiles.length);
    }, 1000);
    
  } catch (error) {
    console.error('加载DICOM失败:', error);
    alert('加载DICOM文件失败: ' + error.message);
  }
}

function setupViewports() {
  try {
    if (renderingEngine.hasViewports()) {
      renderingEngine.disableElement(document.getElementById(viewportIds.axial));
      renderingEngine.disableElement(document.getElementById(viewportIds.coronal));
      renderingEngine.disableElement(document.getElementById(viewportIds.sagittal));
      renderingEngine.disableElement(document.getElementById(viewportIds.volume));
    }
  } catch (e) {
  }
  
  const viewportInputArray = [
    {
      viewportId: viewportIds.axial,
      type: ViewportType.ORTHOGRAPHIC,
      element: document.getElementById(viewportIds.axial),
      defaultOptions: {
        orientation: Enums.OrientationAxis.AXIAL,
        background: [0, 0, 0],
      },
    },
    {
      viewportId: viewportIds.coronal,
      type: ViewportType.ORTHOGRAPHIC,
      element: document.getElementById(viewportIds.coronal),
      defaultOptions: {
        orientation: Enums.OrientationAxis.CORONAL,
        background: [0, 0, 0],
      },
    },
    {
      viewportId: viewportIds.sagittal,
      type: ViewportType.ORTHOGRAPHIC,
      element: document.getElementById(viewportIds.sagittal),
      defaultOptions: {
        orientation: Enums.OrientationAxis.SAGITTAL,
        background: [0, 0, 0],
      },
    },
    {
      viewportId: viewportIds.volume,
      type: ViewportType.VOLUME_3D,
      element: document.getElementById(viewportIds.volume),
      defaultOptions: {
        background: [0, 0, 0],
      },
    },
  ];
  
  renderingEngine.setViewports(viewportInputArray);
  
    const volumeActor = volume.getCornerstoneActor();
    
    Object.values(viewportIds).forEach((viewportId, index) => {
      const viewport = renderingEngine.getViewport(viewportId);
      if (index < 3) {
        viewport.setVolumes([{ volumeId: volume.volumeId, actor: volumeActor }]);
      } else {
        viewport.setVolumes([{ volumeId: volume.volumeId, actor: volumeActor, callback: setPreset }]);
      }
      viewport.render();
    });
    
    setupSliceSliders();
    
    const segmentBtn = document.getElementById('aiSegmentBtn');
    segmentBtn.disabled = !aiModelManager.getModelInfo().loaded;
  }

function setPreset(actor) {
  cleanupVtkResources();
  
  const mapper = actor.getMapper();
  if (mapper) {
    mapper.setSampleDistance(0.7);
  }
  
  vtkColorTransferFunction = vtk.Rendering.Core.vtkColorTransferFunction.newInstance();
  vtkColorTransferFunction.addRGBPoint(0, 0, 0, 0);
  vtkColorTransferFunction.addRGBPoint(500, 1, 1, 1);
  
  vtkPiecewiseFunction = vtk.Rendering.Core.vtkPiecewiseFunction.newInstance();
  vtkPiecewiseFunction.addPoint(0, 0);
  vtkPiecewiseFunction.addPoint(255, 1);
  
  actor.getProperty().setRGBTransferFunction(0, vtkColorTransferFunction);
  actor.getProperty().setScalarOpacity(0, vtkPiecewiseFunction);
  actor.getProperty().setInterpolationTypeToLinear();
}

function setupSliceSliders() {
  if (!volume || !volume.dimensions) return;
  
  const dimensions = volume.dimensions;
  
  const axialSlider = document.getElementById('axialSlider');
  axialSlider.max = dimensions[2] - 1;
  axialSlider.value = Math.floor(dimensions[2] / 2);
  
  const coronalSlider = document.getElementById('coronalSlider');
  coronalSlider.max = dimensions[1] - 1;
  coronalSlider.value = Math.floor(dimensions[1] / 2);
  
  const sagittalSlider = document.getElementById('sagittalSlider');
  sagittalSlider.max = dimensions[0] - 1;
  sagittalSlider.value = Math.floor(dimensions[0] / 2);
}

function setViewportSlice(viewportId, orientation, sliceIndex) {
  if (!renderingEngine) return;
  const viewport = renderingEngine.getViewport(viewportId);
  if (!viewport) return;
  
  const sliceRange = viewport.getSliceRange();
  const fraction = (sliceIndex - sliceRange.min) / (sliceRange.max - sliceRange.min);
  viewport.setSlice(fraction);
  viewport.render();
}

function applyWindowLevel(windowWidth, windowCenter) {
  if (!renderingEngine) return;
  
  Object.values(viewportIds).forEach((viewportId) => {
    const viewport = renderingEngine.getViewport(viewportId);
    if (viewport && viewport.setProperties) {
      viewport.setProperties({
        voiRange: {
          lower: windowCenter - windowWidth / 2,
          upper: windowCenter + windowWidth / 2,
        },
      });
      viewport.render();
    }
  });
}

function startContourMode(viewType) {
  if (contourMode) {
    stopContourMode();
  }
  
  contourMode = true;
  currentView = viewType;
  currentContourPoints = [];
  document.getElementById('currentView').textContent = getViewName(viewType);
  document.getElementById('pointCount').textContent = '0';
  
  const viewportElement = document.getElementById(viewportIds[viewType]);
  viewportElement.addEventListener('click', handleViewportClick);
  viewportElement.style.cursor = 'crosshair';
}

function handleViewportClick(event) {
  if (!contourMode) return;
  
  const rect = event.target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  currentContourPoints.push({ x, y });
  document.getElementById('pointCount').textContent = currentContourPoints.length;
  
  drawContour();
}

function drawContour() {
  const canvas = getOrCreateCanvas(currentView);
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (currentContourPoints.length > 0) {
    ctx.beginPath();
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.moveTo(currentContourPoints[0].x, currentContourPoints[0].y);
    
    for (let i = 1; i < currentContourPoints.length; i++) {
      ctx.lineTo(currentContourPoints[i].x, currentContourPoints[i].y);
    }
    
    if (currentContourPoints.length > 2) {
      ctx.lineTo(currentContourPoints[0].x, currentContourPoints[0].y);
    }
    
    ctx.stroke();
    
    currentContourPoints.forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = index === 0 ? '#28a745' : '#ff6b6b';
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function getOrCreateCanvas(viewType) {
  const viewportElement = document.getElementById(viewportIds[viewType]);
  let canvas = viewportElement.querySelector('.contour-canvas');
  
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'contour-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    viewportElement.appendChild(canvas);
  }
  
  canvas.width = viewportElement.clientWidth;
  canvas.height = viewportElement.clientHeight;
  
  return canvas;
}

function getViewName(viewType) {
  const names = {
    axial: '轴状位',
    coronal: '冠状位',
    sagittal: '矢状位'
  };
  return names[viewType] || viewType;
}

function undoLastPoint() {
  if (currentContourPoints.length > 0) {
    currentContourPoints.pop();
    document.getElementById('pointCount').textContent = currentContourPoints.length;
    drawContour();
  }
}

function clearCurrentContour() {
  currentContourPoints = [];
  document.getElementById('pointCount').textContent = '0';
  drawContour();
}

async function finishContour() {
  if (currentContourPoints.length < 3) {
    alert('请至少勾画3个点以形成闭合轮廓');
    return;
  }
  
  const contourName = document.getElementById('contourName').value || `轮廓 ${savedContours.length + 1}`;
  const area = calculatePolygonArea(currentContourPoints);
  const vol = estimateVolume(area);
  
  const contourData = {
    id: Date.now(),
    name: contourName,
    points: [...currentContourPoints],
    viewType: currentView,
    area: area,
    volume: vol,
    createdAt: new Date().toISOString()
  };
  
  if (currentCaseId) {
    await window.electronAPI.saveContour({
      caseId: currentCaseId,
      contourName: contourName,
      contourData: contourData,
      volume: vol,
      viewType: currentView
    });
  }
  
  savedContours.push(contourData);
  updateContoursList();
  
  clearCurrentContour();
  stopContourMode();
}

function stopContourMode() {
  contourMode = false;
  try {
    const viewportElement = document.getElementById(viewportIds[currentView]);
    viewportElement.removeEventListener('click', handleViewportClick);
    viewportElement.style.cursor = 'default';
  } catch (e) {
  }
  document.getElementById('contourModeBtn').classList.remove('active');
}

function calculatePolygonArea(points) {
  if (points.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  return Math.abs(area / 2);
}

function estimateVolume(area2d) {
  if (!volume) return area2d;
  const spacing = volume.spacing || [1, 1, 1];
  const sliceThickness = spacing[2] || 1;
  const pixelArea = spacing[0] * spacing[1];
  const realArea = area2d * pixelArea;
  return realArea * sliceThickness;
}

function updateContoursList() {
  const container = document.getElementById('savedContours');
  container.innerHTML = '';
  
  savedContours.forEach(contour => {
    const item = document.createElement('div');
    item.className = 'contour-item';
    item.innerHTML = `
      <span>${contour.name} (${getViewName(contour.viewType)})</span>
      <span class="volume">${contour.volume.toFixed(2)} mm³</span>
    `;
    container.appendChild(item);
  });
}

function calculateAllVolumes() {
  if (savedContours.length === 0) {
    alert('没有已保存的轮廓');
    return;
  }
  
  const resultsContainer = document.getElementById('volumeResults');
  resultsContainer.innerHTML = '';
  
  let totalVolume = 0;
  
  savedContours.forEach(contour => {
    const item = document.createElement('div');
    item.className = 'volume-result-item';
    item.innerHTML = `
      <h4>${contour.name}</h4>
      <div class="result-row">
        <span>视图:</span>
        <span>${getViewName(contour.viewType)}</span>
      </div>
      <div class="result-row">
        <span>面积:</span>
        <span class="result-value">${contour.area.toFixed(2)} mm²</span>
      </div>
      <div class="result-row">
        <span>体积:</span>
        <span class="result-value">${contour.volume.toFixed(2)} mm³</span>
      </div>
    `;
    resultsContainer.appendChild(item);
    totalVolume += contour.volume;
  });
  
  const totalItem = document.createElement('div');
  totalItem.className = 'volume-result-item';
  totalItem.innerHTML = `
    <h4 style="color: #28a745;">总计</h4>
    <div class="result-row">
      <span>轮廓数量:</span>
      <span class="result-value">${savedContours.length}</span>
    </div>
    <div class="result-row">
      <span>总体积:</span>
      <span class="result-value">${totalVolume.toFixed(2)} mm³</span>
    </div>
  `;
  resultsContainer.appendChild(totalItem);
  
  document.getElementById('volumePanel').style.display = 'block';
}

async function saveCase(folderPath, fileCount) {
  const caseData = {
    patientId: `PAT-${Date.now()}`,
    patientName: `患者 ${fileCount} 张图像`,
    studyDate: new Date().toISOString().split('T')[0],
    studyDescription: 'CT/MRI 扫描',
    modality: 'CT',
    thumbnailPath: '',
    dicomFolder: folderPath
  };
  
  currentCaseId = await window.electronAPI.saveCase(caseData);
  document.getElementById('patientInfo').textContent = `${caseData.patientName} - ${caseData.studyDate}`;
  
  loadCases();
}

async function loadCases() {
  const cases = await window.electronAPI.getCases();
  const container = document.getElementById('casesContainer');
  container.innerHTML = '';
  
  cases.forEach(caseItem => {
    const item = document.createElement('div');
    item.className = 'case-item';
    item.innerHTML = `
      <h4>${caseItem.patientName}</h4>
      <p>${caseItem.studyDate} | ${caseItem.modality}</p>
    `;
    item.onclick = () => loadCase(caseItem);
    container.appendChild(item);
  });
}

async function loadCase(caseItem) {
  if (caseItem.dicomFolder) {
    await loadDicomFolder(caseItem.dicomFolder);
    currentCaseId = caseItem.id;
    
    const contours = await window.electronAPI.getContours(currentCaseId);
    savedContours = contours.map(c => c.contourData);
    updateContoursList();
  }
}

async function exportContoursToJson() {
  if (savedContours.length === 0) {
    alert('没有轮廓数据可导出');
    return;
  }
  
  const exportData = {
    caseId: currentCaseId,
    exportDate: new Date().toISOString(),
    contours: savedContours
  };
  
  const path = await window.electronAPI.openFolderDialog();
  if (path) {
    const exportPath = `${path}/contours_${Date.now()}.json`;
    await window.electronAPI.exportJson(exportData, exportPath);
    alert('JSON导出成功: ' + exportPath);
  }
}

async function exportMeasurementsToCsv() {
  if (savedContours.length === 0) {
    alert('没有测量数据可导出');
    return;
  }
  
  const measurements = savedContours.map(c => ({
    name: c.name,
    volume: c.volume,
    area: c.area,
    date: c.createdAt
  }));
  
  const path = await window.electronAPI.openFolderDialog();
  if (path) {
    const exportPath = `${path}/measurements_${Date.now()}.csv`;
    await window.electronAPI.exportCsv(measurements, exportPath);
    alert('CSV导出成功: ' + exportPath);
  }
}

function setupEventListeners() {
  const dropZone = document.getElementById('dropZone');
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const path = file.path;
      await loadDicomFolder(path);
    }
  });
  
  dropZone.addEventListener('click', async () => {
    const path = await window.electronAPI.openFolderDialog();
    if (path) {
      await loadDicomFolder(path);
    }
  });
  
  document.getElementById('selectFolderBtn').addEventListener('click', async () => {
    const path = await window.electronAPI.openFolderDialog();
    if (path) {
      await loadDicomFolder(path);
    }
  });
  
  document.getElementById('axialSlider').addEventListener('input', (e) => {
    document.getElementById('axialSliceNum').textContent = e.target.value;
    setViewportSlice(viewportIds.axial, 'axial', parseInt(e.target.value));
  });
  
  document.getElementById('coronalSlider').addEventListener('input', (e) => {
    document.getElementById('coronalSliceNum').textContent = e.target.value;
    setViewportSlice(viewportIds.coronal, 'coronal', parseInt(e.target.value));
  });
  
  document.getElementById('sagittalSlider').addEventListener('input', (e) => {
    document.getElementById('sagittalSliceNum').textContent = e.target.value;
    setViewportSlice(viewportIds.sagittal, 'sagittal', parseInt(e.target.value));
  });
  
  document.getElementById('applyWindowBtn').addEventListener('click', () => {
    const width = parseInt(document.getElementById('windowWidth').value);
    const center = parseInt(document.getElementById('windowCenter').value);
    applyWindowLevel(width, center);
  });
  
  document.getElementById('contourModeBtn').addEventListener('click', () => {
    const btn = document.getElementById('contourModeBtn');
    if (contourMode) {
      stopContourMode();
      document.getElementById('contourPanel').style.display = 'none';
    } else {
      btn.classList.add('active');
      document.getElementById('contourPanel').style.display = 'block';
      startContourMode('axial');
    }
  });
  
  document.getElementById('startContourBtn').addEventListener('click', () => {
    if (!contourMode) {
      startContourMode('axial');
    }
  });
  
  document.getElementById('undoPointBtn').addEventListener('click', undoLastPoint);
  document.getElementById('clearContourBtn').addEventListener('click', clearCurrentContour);
  document.getElementById('finishContourBtn').addEventListener('click', finishContour);
  
  document.getElementById('calculateVolumeBtn').addEventListener('click', calculateAllVolumes);
  document.getElementById('exportJsonBtn').addEventListener('click', exportContoursToJson);
  document.getElementById('exportCsvBtn').addEventListener('click', exportMeasurementsToCsv);
  
  document.getElementById('resetVolumeBtn').addEventListener('click', () => {
    if (!renderingEngine) return;
    const viewport = renderingEngine.getViewport(viewportIds.volume);
    if (viewport) {
      viewport.resetCamera();
      viewport.render();
    }
  });
  
  ['axial', 'coronal', 'sagittal'].forEach(view => {
    document.getElementById(viewportIds[view]).addEventListener('click', () => {
      if (document.getElementById('contourPanel').style.display !== 'none') {
        if (aiGeneratedContour) {
          return;
        }
        stopContourMode();
        startContourMode(view);
      }
    });
  });
  
  document.getElementById('loadModelBtn').addEventListener('click', loadAIModel);
  document.getElementById('aiSegmentBtn').addEventListener('click', runAISegmentation);
  document.getElementById('acceptAiBtn').addEventListener('click', acceptAIContour);
  document.getElementById('refineAiBtn').addEventListener('click', refineAIContour);
  document.getElementById('rejectAiBtn').addEventListener('click', rejectAIContour);
  
  window.addEventListener('beforeunload', () => {
    cleanupAllResources();
  });
}

let rendererGCInterval;

async function init() {
  await initCornerstone();
  setupEventListeners();
  loadCases();
  
  rendererGCInterval = setInterval(() => {
    forceGC();
  }, 60000);
}

window.addEventListener('unload', () => {
  if (rendererGCInterval) {
    clearInterval(rendererGCInterval);
  }
  cleanupAllResources();
});

init().catch(console.error);
