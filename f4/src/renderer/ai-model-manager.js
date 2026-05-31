import * as ort from 'onnxruntime-web';

ort.env.wasm.numThreads = 4;
ort.env.wasm.simd = true;
ort.env.allowLocalModelsOnly = true;

class AIModelManager {
  constructor() {
    this.model = null;
    this.modelLoaded = false;
    this.isProcessing = false;
    this.modelPath = 'models/liver_segmentation.onnx';
    this.inputSize = [256, 256];
    this.pixelMean = 0.0;
    this.pixelStd = 255.0;
    this.windowWidth = 400;
    this.windowCenter = 40;
  }

  async loadModel() {
    if (this.modelLoaded) return true;
    
    try {
      console.log('正在加载AI分割模型...');
      const sessionOptions = {
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true
      };
      
      this.model = await ort.InferenceSession.create(this.modelPath, sessionOptions);
      this.modelLoaded = true;
      console.log('AI模型加载成功！');
      return true;
    } catch (error) {
      console.warn('模型文件不存在，使用模拟推理模式:', error.message);
      this.modelLoaded = false;
      return false;
    }
  }

  preprocessImage(imageData, width, height) {
    const [targetWidth, targetHeight] = this.inputSize;
    
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < imageData.length; i++) {
      minVal = Math.min(minVal, imageData[i]);
      maxVal = Math.max(maxVal, imageData[i]);
    }
    
    const lowerBound = this.windowCenter - this.windowWidth / 2;
    const upperBound = this.windowCenter + this.windowWidth / 2;
    
    const normalizedData = new Float32Array(targetWidth * targetHeight);
    
    const scaleX = width / targetWidth;
    const scaleY = height / targetHeight;
    
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const srcIdx = srcY * width + srcX;
        let val = imageData[srcIdx];
        
        val = Math.max(lowerBound, Math.min(upperBound, val));
        val = (val - lowerBound) / (upperBound - lowerBound);
        normalizedData[y * targetWidth + x] = val;
      }
    }
    
    return normalizedData;
  }

  async runInference(imageData, width, height) {
    if (this.isProcessing) {
      throw new Error('模型正在处理中，请稍候...');
    }
    
    this.isProcessing = true;
    
    try {
      const preprocessed = this.preprocessImage(imageData, width, height);
      const inputTensor = new ort.Tensor('float32', preprocessed, [1, 1, this.inputSize[1], this.inputSize[0]]);
      
      let mask;
      if (this.modelLoaded && this.model) {
        const outputs = await this.model.run({ input: inputTensor });
        const outputName = Object.keys(outputs)[0];
        const outputData = outputs[outputName].data;
        
        mask = this.postprocessOutput(outputData, width, height);
      } else {
        mask = this.simulateSegmentation(width, height);
      }
      
      this.isProcessing = false;
      return mask;
    } catch (error) {
      this.isProcessing = false;
      console.error('推理失败:', error);
      throw error;
    }
  }

  postprocessOutput(outputData, originalWidth, originalHeight) {
    const [targetWidth, targetHeight] = this.inputSize;
    const mask = new Uint8Array(originalWidth * originalHeight);
    
    const scaleX = targetWidth / originalWidth;
    const scaleY = targetHeight / originalHeight;
    const threshold = 0.5;
    
    for (let y = 0; y < originalHeight; y++) {
      for (let x = 0; x < originalWidth; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const srcIdx = srcY * targetWidth + srcX;
        
        const prob = outputData[srcIdx];
        mask[y * originalWidth + x] = prob > threshold ? 1 : 0;
      }
    }
    
    return mask;
  }

  simulateSegmentation(width, height) {
    console.log('使用模拟分割结果');
    const mask = new Uint8Array(width * height);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.25;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < radius) {
          const angle = Math.atan2(dy, dx);
          const distortion = radius * 0.15 * Math.sin(angle * 4);
          if (dist < radius + distortion) {
            mask[y * width + x] = 1;
          }
        }
      }
    }
    
    return mask;
  }

  maskToContourPoints(mask, width, height) {
    const points = [];
    const visited = new Set();
    const startPoint = this.findContourStart(mask, width, height);
    
    if (!startPoint) return points;
    
    let current = startPoint;
    let count = 0;
    const maxPoints = 5000;
    
    while (current && !visited.has(`${current.x},${current.y}`) && count < maxPoints) {
      visited.add(`${current.x},${current.y}`);
      points.push({ x: current.x, y: current.y });
      current = this.findNextContourPoint(mask, width, height, current.x, current.y, visited);
      count++;
    }
    
    return this.simplifyContour(points, 2.0);
  }

  findContourStart(mask, width, height) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x] === 1) {
          return { x, y };
        }
      }
    }
    return null;
  }

  findNextContourPoint(mask, width, height, x, y, visited) {
    const directions = [
      { dx: 1, dy: 0 }, { dx: 1, dy: -1 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 },
      { dx: -1, dy: 0 }, { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }
    ];
    
    for (const dir of directions) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (mask[ny * width + nx] === 1 && !visited.has(`${nx},${ny}`)) {
          if (this.isBoundaryPoint(mask, width, height, nx, ny)) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    
    return null;
  }

  isBoundaryPoint(mask, width, height, x, y) {
    const directions = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
    ];
    
    for (const dir of directions) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        return true;
      }
      
      if (mask[ny * width + nx] === 0) {
        return true;
      }
    }
    
    return false;
  }

  simplifyContour(points, tolerance) {
    if (points.length <= 2) return points;
    
    const result = [points[0]];
    let lastAdded = points[0];
    
    for (let i = 1; i < points.length - 1; i++) {
      const dist = Math.sqrt(
        Math.pow(points[i].x - lastAdded.x, 2) + 
        Math.pow(points[i].y - lastAdded.y, 2)
      );
      
      if (dist >= tolerance) {
        result.push(points[i]);
        lastAdded = points[i];
      }
    }
    
    result.push(points[points.length - 1]);
    
    return result;
  }

  async segmentSlice(imageData, width, height) {
    const mask = await this.runInference(imageData, width, height);
    const contourPoints = this.maskToContourPoints(mask, width, height);
    return { mask, contourPoints };
  }

  setWindowLevel(width, center) {
    this.windowWidth = width;
    this.windowCenter = center;
  }

  getModelInfo() {
    return {
      loaded: this.modelLoaded,
      inputSize: this.inputSize,
      windowWidth: this.windowWidth,
      windowCenter: this.windowCenter
    };
  }
}

export const aiModelManager = new AIModelManager();
