const THREE = require('three');
const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls');
const { OctreeLOD } = require('./js/Octree');
const { AnnotationManager } = require('./js/AnnotationManager');
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

class PointCloudViewer {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.octreeLOD = null;
    this.boundingBoxGroup = null;
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    this.annotationManager = null;
    
    this.fpsFrames = 0;
    this.fpsLastTime = performance.now();
    this.currentFPS = 60;
    
    this.settings = {
      lodDistanceFactor: 1.0,
      maxPointsPerNode: 50000,
      enableFrustumCulling: true,
      showBoundingBoxes: false,
      pointSize: 2.0
    };
    
    this.init();
    this.setupEventListeners();
    this.setupAnnotationEvents();
    this.animate();
  }

  init() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    this.camera.position.set(50, 50, 50);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    
    this.boundingBoxGroup = new THREE.Group();
    this.scene.add(this.boundingBoxGroup);
    
    const gridHelper = new THREE.GridHelper(100, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);
    
    this.annotationManager = new AnnotationManager(this.scene, this.camera, this.renderer);
    
    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupEventListeners() {
    document.getElementById('btn-import-files').addEventListener('click', () => {
      this.importPointCloud();
    });
    
    document.getElementById('btn-generate-demo').addEventListener('click', () => {
      this.generateDemoPointCloud();
    });
    
    document.getElementById('lod-distance').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.settings.lodDistanceFactor = value;
      document.getElementById('lod-distance-value').textContent = value.toFixed(1);
      if (this.octreeLOD) {
        this.octreeLOD.setLODDistanceFactor(value);
      }
    });
    
    document.getElementById('max-points').addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.settings.maxPointsPerNode = value;
      document.getElementById('max-points-value').textContent = value;
    });
    
    document.getElementById('frustum-culling').addEventListener('change', (e) => {
      this.settings.enableFrustumCulling = e.target.checked;
      if (this.octreeLOD) {
        this.octreeLOD.setFrustumCulling(e.target.checked);
      }
    });
    
    document.getElementById('show-bounding-boxes').addEventListener('change', (e) => {
      this.settings.showBoundingBoxes = e.target.checked;
      this.toggleBoundingBoxes(e.target.checked);
    });
    
    document.getElementById('point-size').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.settings.pointSize = value;
      document.getElementById('point-size-value').textContent = value.toFixed(1);
      if (this.octreeLOD) {
        this.octreeLOD.setPointSize(value);
      }
    });
  }

  setupAnnotationEvents() {
    const canvas = this.renderer.domElement;
    const annotateBtn = document.getElementById('btn-annotate');
    const statusEl = document.getElementById('annotation-status');
    
    annotateBtn.addEventListener('click', () => {
      if (this.annotationManager.isAnnotating) {
        this.annotationManager.disableAnnotationMode();
        annotateBtn.textContent = '🔴 开始标注模式';
        annotateBtn.classList.remove('btn-success');
        annotateBtn.classList.add('btn-secondary');
        statusEl.classList.remove('active');
        statusEl.textContent = '点击点云上的两点进行测量';
        this.controls.enabled = true;
      } else {
        this.annotationManager.enableAnnotationMode();
        annotateBtn.textContent = '⬜ 结束标注模式';
        annotateBtn.classList.remove('btn-secondary');
        annotateBtn.classList.add('btn-success');
        statusEl.classList.add('active');
        statusEl.textContent = '已选择第1个点，点击选择第2个点...';
        this.controls.enabled = false;
      }
    });
    
    canvas.addEventListener('click', (e) => {
      if (!this.octreeLOD) return;
      
      const allMeshes = this.octreeLOD.getAllMeshes();
      const visibleMeshes = allMeshes.filter(m => m.visible);
      this.annotationManager.setPointCloudMeshes(visibleMeshes);
      
      const result = this.annotationManager.handleClick(e, canvas);
      if (result) {
        if (result.type === 'first_point') {
          statusEl.textContent = '已选择第1个点，点击选择第2个点...';
        } else if (result.type === 'annotation_created') {
          statusEl.textContent = '标注成功！继续点击添加新标注';
          this.updateAnnotationList();
        }
      }
    });
    
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      this.exportAnnotations('csv');
    });
    
    document.getElementById('btn-export-json').addEventListener('click', () => {
      this.exportAnnotations('json');
    });
    
    document.getElementById('btn-clear-annotations').addEventListener('click', () => {
      this.annotationManager.clearAllAnnotations();
      this.updateAnnotationList();
    });
    
    this.annotationManager.onAnnotationCreated = () => {
      this.updateAnnotationList();
    };
  }

  updateAnnotationList() {
    const listEl = document.getElementById('annotation-list');
    const annotations = this.annotationManager.getAnnotations();
    
    if (annotations.length === 0) {
      listEl.innerHTML = '<div class="empty-list">暂无标注</div>';
      return;
    }
    
    listEl.innerHTML = annotations.map(a => `
      <div class="annotation-item" data-id="${a.id}">
        <div class="annotation-info">
          <div class="annotation-name">${a.name}</div>
          <div class="annotation-distance">
            距离: ${a.distance.toFixed(4)} 单位<br>
            毫米: ${a.distanceMm.toFixed(3)} mm
          </div>
        </div>
        <button class="annotation-delete" data-id="${a.id}">删除</button>
      </div>
    `).join('');
    
    listEl.querySelectorAll('.annotation-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        this.annotationManager.deleteAnnotation(id);
        this.updateAnnotationList();
      });
    });
    
    listEl.querySelectorAll('.annotation-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        this.annotationManager.selectAnnotation(id);
        
        listEl.querySelectorAll('.annotation-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  async exportAnnotations(format) {
    const annotations = this.annotationManager.getAnnotations();
    if (annotations.length === 0) {
      alert('没有可导出的标注数据');
      return;
    }
    
    let content, extension, defaultPath;
    const timestamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
    
    if (format === 'csv') {
      content = this.annotationManager.exportCSV();
      extension = 'csv';
      defaultPath = `annotations_${timestamp}.csv`;
    } else {
      content = this.annotationManager.exportJSON();
      extension = 'json';
      defaultPath = `annotations_${timestamp}.json`;
    }
    
    const { filePath } = await ipcRenderer.invoke('save-file-dialog', {
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [extension] }]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, content, 'utf8');
      alert(`导出成功: ${filePath}`);
    }
  }

  async importPointCloud() {
    const filePaths = await ipcRenderer.invoke('select-files');
    if (filePaths && filePaths.length > 0) {
      this.updateProgress('正在加载点云...', 0);
      
      setTimeout(async () => {
        try {
          const content = await ipcRenderer.invoke('read-point-cloud-file', filePaths[0]);
          const { points, colors } = this.parsePointCloud(content, filePaths[0]);
          this.loadPointCloud(points, colors);
        } catch (error) {
          console.error('加载点云失败:', error);
          this.updateProgress('加载失败: ' + error.message, 0);
        }
      }, 100);
    }
  }

  parsePointCloud(content, filePath) {
    const points = [];
    const colors = [];
    
    const lines = content.trim().split('\n');
    let inHeader = true;
    let propertyMap = {};
    
    if (filePath.toLowerCase().endsWith('.ply')) {
      let i = 0;
      let vertexCount = 0;
      
      while (i < lines.length && lines[i].trim() !== 'end_header') {
        const line = lines[i].trim();
        if (line.startsWith('element vertex')) {
          vertexCount = parseInt(line.split(' ')[2]);
        } else if (line.startsWith('property')) {
          const parts = line.split(' ');
          propertyMap[parts[2]] = Object.keys(propertyMap).length;
        }
        i++;
      }
      i++;
      
      const hasColor = 'red' in propertyMap && 'green' in propertyMap && 'blue' in propertyMap;
      const xIdx = propertyMap.x || 0;
      const yIdx = propertyMap.y || 1;
      const zIdx = propertyMap.z || 2;
      const rIdx = propertyMap.red || 3;
      const gIdx = propertyMap.green || 4;
      const bIdx = propertyMap.blue || 5;
      
      for (let j = 0; j < vertexCount && i < lines.length; j++, i++) {
        const parts = lines[i].trim().split(/\s+/).map(parseFloat);
        points.push(new THREE.Vector3(parts[xIdx], parts[yIdx], parts[zIdx]));
        
        if (hasColor) {
          colors.push(new THREE.Color(
            parts[rIdx] / 255,
            parts[gIdx] / 255,
            parts[bIdx] / 255
          ));
        } else {
          colors.push(this.getPointColor(parts[xIdx], parts[yIdx], parts[zIdx]));
        }
      }
    } else {
      for (const line of lines) {
        const parts = line.trim().split(/\s+/).map(parseFloat);
        if (parts.length >= 3) {
          points.push(new THREE.Vector3(parts[0], parts[1], parts[2]));
          
          if (parts.length >= 6) {
            colors.push(new THREE.Color(parts[3] / 255, parts[4] / 255, parts[5] / 255));
          } else {
            colors.push(this.getPointColor(parts[0], parts[1], parts[2]));
          }
        }
      }
    }
    
    return { points, colors };
  }

  getPointColor(x, y, z) {
    const distance = Math.sqrt(x * x + y * y + z * z);
    const normalizedDist = Math.min(distance / 50, 1);
    
    const color = new THREE.Color();
    color.setHSL(normalizedDist * 0.6, 0.8, 0.5);
    return color;
  }

  generateDemoPointCloud() {
    this.updateProgress('正在生成测试点云...', 0);
    
    setTimeout(() => {
      const pointCount = 3000000;
      const points = [];
      const colors = [];
      
      const progressInterval = setInterval(() => {
        const progress = Math.min((points.length / pointCount) * 100, 100);
        this.updateProgress(`正在生成测试点云... ${Math.floor(progress)}%`, progress);
      }, 200);
      
      for (let i = 0; i < pointCount; i++) {
        const x = (Math.random() - 0.5) * 100;
        const y = (Math.random() - 0.5) * 100;
        const z = (Math.random() - 0.5) * 100;
        
        const shape = Math.random();
        let px, py, pz;
        
        if (shape < 0.3) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI;
          const r = 20 + Math.random() * 10;
          px = r * Math.sin(phi) * Math.cos(theta);
          py = r * Math.sin(phi) * Math.sin(theta);
          pz = r * Math.cos(phi);
        } else if (shape < 0.6) {
          px = (Math.random() - 0.5) * 40 + 30;
          py = (Math.random() - 0.5) * 40;
          pz = (Math.random() - 0.5) * 40 - 30;
        } else if (shape < 0.8) {
          const angle = i * 0.1;
          const radius = 15 + i * 0.0001;
          px = Math.cos(angle) * radius - 30;
          py = (Math.random() - 0.5) * 20;
          pz = Math.sin(angle) * radius + 20;
        } else {
          px = x;
          py = y;
          pz = z;
        }
        
        points.push(new THREE.Vector3(px, py, pz));
        
        const dist = Math.sqrt(px * px + py * py + pz * pz);
        const color = new THREE.Color();
        color.setHSL((dist / 60) * 0.5 + 0.2, 0.7, 0.5);
        colors.push(color);
      }
      
      clearInterval(progressInterval);
      this.loadPointCloud(points, colors);
    }, 100);
  }

  loadPointCloud(points, colors) {
    this.updateProgress('正在构建八叉树...', 30);
    
    setTimeout(() => {
      if (this.octreeLOD) {
        const oldMeshes = this.octreeLOD.getAllMeshes();
        for (const mesh of oldMeshes) {
          this.scene.remove(mesh);
        }
        this.octreeLOD.dispose();
      }
      
      this.octreeLOD = new OctreeLOD(points, colors, {
        maxPointsPerNode: this.settings.maxPointsPerNode,
        lodDistanceFactor: this.settings.lodDistanceFactor,
        enableFrustumCulling: this.settings.enableFrustumCulling,
        pointSize: this.settings.pointSize
      });
      
      const allMeshes = this.octreeLOD.getAllMeshes();
      for (const mesh of allMeshes) {
        this.scene.add(mesh);
        mesh.visible = false;
      }
      
      if (this.settings.showBoundingBoxes) {
        this.toggleBoundingBoxes(true);
      }
      
      this.updateProgress(`点云加载完成！共 ${points.length.toLocaleString()} 个点`, 100);
      
      this.camera.position.set(80, 80, 80);
      this.camera.lookAt(0, 0, 0);
    }, 100);
  }

  toggleBoundingBoxes(show) {
    while (this.boundingBoxGroup.children.length > 0) {
      const child = this.boundingBoxGroup.children[0];
      this.boundingBoxGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    
    if (show && this.octreeLOD) {
      const boxMeshes = this.octreeLOD.getAllBoundingBoxMeshes();
      for (const mesh of boxMeshes) {
        this.boundingBoxGroup.add(mesh);
      }
    }
  }

  updateProgress(text, progress) {
    document.getElementById('progress-text').textContent = text;
    document.getElementById('progress-fill').style.width = progress + '%';
  }

  update() {
    if (this.octreeLOD) {
      this.frustumMatrix.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this.frustum.setFromProjectionMatrix(this.frustumMatrix);
      
      this.octreeLOD.update(this.camera, this.frustum);
      
      const stats = this.octreeLOD.getStats();
      document.getElementById('total-points').textContent = stats.totalPoints.toLocaleString();
      document.getElementById('rendered-points').textContent = stats.renderedPoints.toLocaleString();
      document.getElementById('octree-nodes').textContent = stats.totalNodes.toLocaleString();
      document.getElementById('visible-nodes').textContent = stats.visibleNodes.toLocaleString();
      
      const distance = this.camera.position.length();
      document.getElementById('camera-distance').textContent = distance.toFixed(1);
      
      const lodLevels = `0-2 (动态)`;
      document.getElementById('lod-levels').textContent = lodLevels;
    }
    
    this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    this.update();
    this.render();
    this.updateFPS();
  }

  updateFPS() {
    this.fpsFrames++;
    const now = performance.now();
    
    if (now - this.fpsLastTime >= 1000) {
      this.currentFPS = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastTime));
      document.getElementById('fps-counter').textContent = this.currentFPS;
      this.fpsFrames = 0;
      this.fpsLastTime = now;
    }
  }

  onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new PointCloudViewer();
});
