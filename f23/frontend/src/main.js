import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ELEMENT_COLORS = {
  C: 0x333333,
  N: 0x0000FF,
  O: 0xFF0000,
  H: 0xFFFFFF,
  S: 0xFFFF00,
  P: 0xFFA500,
  F: 0x00FF00,
  CL: 0x00FF00,
  BR: 0x8B0000,
  I: 0x4B0082,
  FE: 0xCD853F,
  MN: 0x9A7EAE,
  CO: 0xFF8C00,
  NI: 0xA52A2A,
  CU: 0xB87333,
  ZN: 0x7B68EE,
  CA: 0x808080,
  MG: 0x228B22,
  NA: 0xAB82FF,
  K: 0x4169E1,
  DEFAULT: 0xFFC0CB
};

const ELEMENT_RADII = {
  C: 0.7,
  N: 0.65,
  O: 0.6,
  H: 0.4,
  S: 1.0,
  P: 1.0,
  DEFAULT: 0.7
};

class MoleculeVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.atoms = [];
    this.atomMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.moleculeId = null;
    this.measureMode = false;
    this.selectedAtoms = [];
    this.measureLines = [];
    this.measureSprites = [];
    this.init();
  }

  async init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 50);

    this.renderer = this.createRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.setupLights();
    this.setupEventListeners();
    this.animate();
  }

  createRenderer() {
    const canvas = this.canvas;
    
    if (canvas.getContext('webgl2')) {
      console.log('Using WebGL2 Renderer');
      return new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
    }
    
    if (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) {
      console.log('Using WebGL Renderer (fallback)');
      return new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
    }
    
    throw new Error('WebGL is not supported in this browser');
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight1.position.set(10, 10, 10);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-10, -10, -10);
    this.scene.add(directionalLight2);
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.onResize());
    this.canvas.addEventListener('click', (event) => this.onMouseClick(event));
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onMouseClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.atomMeshes);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object;
      const atomData = clickedMesh.userData;

      if (this.measureMode) {
        this.handleMeasureSelection(clickedMesh, atomData);
      } else {
        this.showAtomInfo(atomData);
        this.highlightAtom(clickedMesh);
      }
    } else if (!this.measureMode) {
      this.hideAtomInfo();
      this.unhighlightAllAtoms();
    }
  }

  handleMeasureSelection(mesh, atomData) {
    if (this.selectedAtoms.length < 2) {
      this.selectedAtoms.push({ mesh, atomData });
      mesh.originalScale = mesh.scale.clone();
      mesh.scale.multiplyScalar(1.5);
      this.updateMeasureStatus();

      if (this.selectedAtoms.length === 2) {
        this.calculateAndShowDistance();
        this.measureMode = false;
        document.getElementById('measureModeBtn').textContent = '开始测量';
      }
    }
  }

  calculateAndShowDistance() {
    const [atom1, atom2] = this.selectedAtoms;
    const pos1 = atom1.mesh.position;
    const pos2 = atom2.mesh.position;
    
    const distance = pos1.distanceTo(pos2);
    
    this.createMeasureLine(pos1, pos2, distance);
    this.showMeasureResult(atom1.atomData, atom2.atomData, distance);
    this.clearAtomSelection();
  }

  createMeasureLine(pos1, pos2, distance) {
    const points = [pos1.clone(), pos2.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
      color: 0x00ff00, 
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.measureLines.push(line);

    this.createDistanceLabel(pos1, pos2, distance);
  }

  createDistanceLabel(pos1, pos2, distance) {
    const midPoint = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;
    
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.font = 'bold 48px Arial';
    context.fillStyle = '#00ff00';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${distance.toFixed(2)} Å`, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(midPoint);
    sprite.scale.set(5, 2.5, 1);
    
    this.scene.add(sprite);
    this.measureSprites.push(sprite);
  }

  showMeasureResult(atom1, atom2, distance) {
    const resultsContainer = document.getElementById('measureResults');
    const resultDiv = document.createElement('div');
    resultDiv.style.cssText = `
      background: #e8f5e9;
      padding: 10px;
      border-radius: 4px;
      margin-top: 5px;
      border-left: 4px solid #4caf50;
    `;
    resultDiv.innerHTML = `
      <strong>${atom1.resName} ${atom1.name}</strong> → <strong>${atom2.resName} ${atom2.name}</strong>
      <br>距离: <span style="color: #2e7d32; font-weight: bold;">${distance.toFixed(3)} Å</span>
    `;
    resultsContainer.appendChild(resultDiv);
  }

  updateMeasureStatus() {
    const statusEl = document.getElementById('measureStatus');
    if (this.selectedAtoms.length === 0) {
      statusEl.textContent = '点击第一个原子开始测量';
      statusEl.style.background = '#f0f0f0';
    } else if (this.selectedAtoms.length === 1) {
      statusEl.textContent = '已选择1个原子，请点击第二个原子';
      statusEl.style.background = '#fff3e0';
    }
  }

  clearAtomSelection() {
    this.selectedAtoms.forEach(item => {
      if (item.mesh.originalScale) {
        item.mesh.scale.copy(item.mesh.originalScale);
        delete item.mesh.originalScale;
      }
    });
    this.selectedAtoms = [];
    this.updateMeasureStatus();
  }

  clearAllMeasurements() {
    this.measureLines.forEach(line => {
      this.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    });
    this.measureLines = [];

    this.measureSprites.forEach(sprite => {
      this.scene.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
    });
    this.measureSprites = [];

    this.clearAtomSelection();
    document.getElementById('measureResults').innerHTML = '';
  }

  toggleMeasureMode() {
    this.measureMode = !this.measureMode;
    const btn = document.getElementById('measureModeBtn');
    
    if (this.measureMode) {
      btn.textContent = '取消测量';
      btn.style.background = '#f44336';
      this.unhighlightAllAtoms();
      this.hideAtomInfo();
    } else {
      btn.textContent = '开始测量';
      btn.style.background = '';
      this.clearAtomSelection();
    }
    this.updateMeasureStatus();
  }

  showAtomInfo(atom) {
    const infoPanel = document.getElementById('infoPanel');
    document.getElementById('atomId').textContent = atom.id;
    document.getElementById('recordType').textContent = atom.recordType || 'ATOM';
    document.getElementById('element').textContent = atom.element;
    document.getElementById('atomName').textContent = atom.name;
    document.getElementById('resName').textContent = atom.resName;
    document.getElementById('chainId').textContent = atom.chainID || '-';
    document.getElementById('coords').textContent = 
      `(${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)})`;
    infoPanel.style.display = 'block';
  }

  hideAtomInfo() {
    document.getElementById('infoPanel').style.display = 'none';
  }

  highlightAtom(mesh) {
    this.unhighlightAllAtoms();
    mesh.originalScale = mesh.scale.clone();
    mesh.scale.multiplyScalar(1.3);
  }

  unhighlightAllAtoms() {
    this.atomMeshes.forEach(mesh => {
      if (mesh.originalScale) {
        mesh.scale.copy(mesh.originalScale);
        delete mesh.originalScale;
      }
    });
  }

  getElementColor(element) {
    const elem = element.toUpperCase();
    return ELEMENT_COLORS[elem] || ELEMENT_COLORS.DEFAULT;
  }

  getElementRadius(element) {
    const elem = element.toUpperCase();
    return ELEMENT_RADII[elem] || ELEMENT_RADII.DEFAULT;
  }

  loadMolecule(atoms, moleculeId = null) {
    this.clearMolecule();
    this.atoms = atoms;
    this.moleculeId = moleculeId;

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    
    const center = this.calculateCenter(atoms);

    atoms.forEach(atom => {
      const color = this.getElementColor(atom.element);
      const radius = this.getElementRadius(atom.element);
      
      const isHetatm = atom.recordType === 'HETATM';
      const material = new THREE.MeshPhongMaterial({
        color: color,
        shininess: isHetatm ? 50 : 100,
        specular: isHetatm ? 0x888888 : 0x444444,
        transparent: isHetatm,
        opacity: isHetatm ? 0.9 : 1.0
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        atom.x - center.x,
        atom.y - center.y,
        atom.z - center.z
      );
      mesh.scale.setScalar(radius);
      mesh.userData = atom;

      this.scene.add(mesh);
      this.atomMeshes.push(mesh);
    });

    this.fitCamera();
    
    document.getElementById('filterSection').style.display = 'block';
    document.getElementById('measureSection').style.display = 'block';
  }

  calculateCenter(atoms) {
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };

    let sumX = 0, sumY = 0, sumZ = 0;
    atoms.forEach(atom => {
      sumX += atom.x;
      sumY += atom.y;
      sumZ += atom.z;
    });

    return {
      x: sumX / atoms.length,
      y: sumY / atoms.length,
      z: sumZ / atoms.length
    };
  }

  fitCamera() {
    const boundingBox = new THREE.Box3();
    this.atomMeshes.forEach(mesh => boundingBox.expandByObject(mesh));
    
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);
    
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    
    this.camera.position.z = cameraZ * 1.5;
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  clearMolecule() {
    this.atomMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.atomMeshes = [];
    this.atoms = [];
    this.clearAllMeasurements();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

async function uploadPDB(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  return response.json();
}

async function fetchMolecule(moleculeId, filters = {}) {
  let url = `/api/molecule/${moleculeId}`;
  const params = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.append(key, value);
  });
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  const response = await fetch(url);
  return response.json();
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const visualizer = new MoleculeVisualizer('canvas');
  let currentMoleculeId = null;

  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('pdbFile');
    const file = fileInput.files[0];

    if (!file) {
      showStatus('请选择一个PDB文件', 'error');
      return;
    }

    try {
      showLoading(true);
      
      const uploadResult = await uploadPDB(file);
      if (!uploadResult.success) {
        throw new Error('上传失败');
      }

      currentMoleculeId = uploadResult.moleculeId;
      const moleculeResult = await fetchMolecule(currentMoleculeId);
      if (!moleculeResult.success) {
        throw new Error('获取分子数据失败');
      }

      visualizer.loadMolecule(moleculeResult.atoms, currentMoleculeId);
      showStatus(`成功加载 ${moleculeResult.atoms.length} 个原子`, 'success');
    } catch (error) {
      console.error('Error:', error);
      showStatus(error.message, 'error');
    } finally {
      showLoading(false);
    }
  });

  document.getElementById('measureModeBtn').addEventListener('click', () => {
    visualizer.toggleMeasureMode();
  });

  document.getElementById('clearMeasureBtn').addEventListener('click', () => {
    visualizer.clearAllMeasurements();
    visualizer.measureMode = false;
    document.getElementById('measureModeBtn').textContent = '开始测量';
    document.getElementById('measureModeBtn').style.background = '';
  });

  document.getElementById('applyFilterBtn').addEventListener('click', async () => {
    if (!currentMoleculeId) {
      showStatus('请先上传分子文件', 'error');
      return;
    }

    const filters = {
      resName: document.getElementById('resNameFilter').value.trim(),
      element: document.getElementById('elementFilter').value.trim(),
      recordType: document.getElementById('recordTypeFilter').value
    };

    try {
      showLoading(true);
      const moleculeResult = await fetchMolecule(currentMoleculeId, filters);
      
      if (!moleculeResult.success) {
        throw new Error('获取分子数据失败');
      }

      visualizer.loadMolecule(moleculeResult.atoms, currentMoleculeId);
      showStatus(`过滤后显示 ${moleculeResult.atoms.length} 个原子`, 'success');
    } catch (error) {
      console.error('Error:', error);
      showStatus(error.message, 'error');
    } finally {
      showLoading(false);
    }
  });

  document.getElementById('clearFilterBtn').addEventListener('click', async () => {
    document.getElementById('resNameFilter').value = '';
    document.getElementById('elementFilter').value = '';
    document.getElementById('recordTypeFilter').value = '';

    if (currentMoleculeId) {
      try {
        showLoading(true);
        const moleculeResult = await fetchMolecule(currentMoleculeId);
        visualizer.loadMolecule(moleculeResult.atoms, currentMoleculeId);
        showStatus(`已清除过滤，显示 ${moleculeResult.atoms.length} 个原子`, 'success');
      } catch (error) {
        console.error('Error:', error);
        showStatus(error.message, 'error');
      } finally {
        showLoading(false);
      }
    }
  });
});
