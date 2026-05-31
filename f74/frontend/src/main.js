import * as THREE from 'three';
import { FirstPersonControls } from './controls/FirstPersonControls.js';
import { ChunkManager } from './terrain/ChunkManager.js';
import { TerrainEditor } from './terrain/TerrainEditor.js';
import { TerrainService } from './services/TerrainService.js';
import { MockTerrainService } from './services/MockTerrainService.js';

class VoxelTerrainApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.loadingElement = document.getElementById('loading');
        this.fpsElement = document.getElementById('fps');
        this.positionElement = document.getElementById('position');
        this.chunkCountElement = document.getElementById('chunk-count');
        this.triangleCountElement = document.getElementById('triangle-count');
        this.lodLevelElement = document.getElementById('lod-level');
        this.editModeElement = document.getElementById('edit-mode');
        this.editRadiusElement = document.getElementById('edit-radius');
        
        this.clock = new THREE.Clock();
        this.frameCount = 0;
        this.lastFpsUpdate = 0;
        
        this.useMockService = true;
        this.editorEnabled = false;
        
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 300);
        
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 50, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);
        
        this.setupLighting();
        this.setupControls();
        this.setupTerrain();
        this.setupEventListeners();
        
        this.hideLoading();
        
        this.animate();
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        sunLight.position.set(50, 100, 50);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 500;
        sunLight.shadow.camera.left = -200;
        sunLight.shadow.camera.right = 200;
        sunLight.shadow.camera.top = 200;
        sunLight.shadow.camera.bottom = -200;
        this.scene.add(sunLight);
        
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d5c35, 0.4);
        this.scene.add(hemiLight);
    }

    setupControls() {
        this.controls = new FirstPersonControls(this.camera, this.renderer.domElement);
        this.controls.moveSpeed = 80;
        this.controls.enabled = true;
    }

    setupTerrain() {
        this.terrainService = this.useMockService 
            ? new MockTerrainService(1337) 
            : new TerrainService('http://localhost:50051');
        
        this.chunkManager = new ChunkManager(this.scene, this.terrainService, {
            chunkSize: 32,
            viewDistance: 6,
            lodDistances: [2, 4, 6, 8]
        });
        
        this.terrainEditor = new TerrainEditor(
            this.scene,
            this.camera,
            this.renderer,
            this.chunkManager,
            this.terrainService
        );
        
        this.chunkManager.streamChunks(this.camera.position);
    }

    setupEventListeners() {
        window.addEventListener('resize', this.onWindowResize.bind(this));
        document.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    onKeyDown(event) {
        if (event.code === 'KeyF') {
            this.toggleEditor();
        }
    }

    toggleEditor() {
        this.editorEnabled = !this.editorEnabled;
        this.terrainEditor.setEnabled(this.editorEnabled);
        this.controls.enabled = !this.editorEnabled;
        
        if (this.editorEnabled) {
            document.exitPointerLock();
            console.log('🛠️  Edit mode enabled - Press F to disable');
        } else {
            console.log('🎮  Edit mode disabled - Press F to enable');
        }
        
        this.updateEditUI();
    }

    updateEditUI() {
        if (this.editModeElement) {
            this.editModeElement.textContent = this.editorEnabled 
                ? (this.terrainEditor.editMode === 'subtract' ? '挖掘' : '添加')
                : '关闭';
        }
        if (this.editRadiusElement && this.terrainEditor) {
            this.editRadiusElement.textContent = this.terrainEditor.mineRadius.toFixed(1);
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    hideLoading() {
        if (this.loadingElement) {
            setTimeout(() => {
                this.loadingElement.style.display = 'none';
            }, 1000);
        }
    }

    updateUI() {
        const now = performance.now();
        this.frameCount++;
        
        if (now - this.lastFpsUpdate >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
            this.fpsElement.textContent = fps;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
        
        const pos = this.camera.position;
        this.positionElement.textContent = 
            `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
        
        this.chunkCountElement.textContent = this.chunkManager.getLoadedChunkCount();
        this.triangleCountElement.textContent = this.chunkManager.getTotalTriangleCount().toLocaleString();
        this.lodLevelElement.textContent = this.chunkManager.getCurrentLODLevel(this.camera.position);
        
        this.updateEditUI();
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        
        const deltaTime = Math.min(this.clock.getDelta(), 0.1);
        
        this.controls.update(deltaTime);
        
        this.chunkManager.update(this.camera.position);
        
        if (this.terrainEditor && this.editorEnabled) {
            this.terrainEditor.update(deltaTime);
        }
        
        this.updateUI();
        
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.controls.dispose();
        this.chunkManager.dispose();
        this.renderer.dispose();
    }
}

let app = null;

window.addEventListener('DOMContentLoaded', () => {
    app = new VoxelTerrainApp();
});

window.addEventListener('beforeunload', () => {
    if (app) {
        app.dispose();
    }
});
