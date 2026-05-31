import * as THREE from 'three';
import { WebGPURenderer } from 'three/addons/renderers/webgpu/WebGPURenderer.js';

export class FluidRenderer {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.points = null;
    this.boundaryBox = null;
    
    this.particleCount = 0;
    this.isDragging = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);
    
    this.externalForceCallback = null;
  }

  async init(particleCount) {
    this.particleCount = particleCount;
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111122);
    
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(4, 3, 6);
    this.camera.lookAt(0, 0, 0);
    
    this.renderer = new WebGPURenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    
    this.createBoundaryBox();
    this.createParticles();
    this.addLights();
    this.setupControls();
    
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  createBoundaryBox() {
    const geometry = new THREE.BoxGeometry(4, 4, 4);
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x444466, transparent: true, opacity: 0.3 })
    );
    this.scene.add(line);
    this.boundaryBox = line;
  }

  createParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      
      const t = i / this.particleCount;
      colors[i * 3] = 0.2 + t * 0.3;
      colors[i * 3 + 1] = 0.5 + t * 0.3;
      colors[i * 3 + 2] = 1.0;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    });
    
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
  }

  addLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(5, 5, 5);
    this.scene.add(pointLight);
  }

  setupControls() {
    let isOrbiting = false;
    let previousMousePosition = { x: 0, y: 0 };
    let spherical = new THREE.Spherical(8, Math.PI / 4, 0);
    
    const updateCamera = () => {
      this.camera.position.setFromSpherical(spherical);
      this.camera.lookAt(0, 0, 0);
    };
    
    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        isOrbiting = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });
    
    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (isOrbiting) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        
        spherical.theta -= deltaX * 0.01;
        spherical.phi += deltaY * 0.01;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
        
        updateCamera();
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });
    
    this.renderer.domElement.addEventListener('mouseup', () => {
      isOrbiting = false;
    });
    
    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    updateCamera();
  }

  onMouseMove(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    if (this.isDragging && this.externalForceCallback) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const planeNormal = new THREE.Vector3();
      this.camera.getWorldDirection(planeNormal);
      this.plane.setFromNormalAndCoplanarPoint(planeNormal, new THREE.Vector3(0, 0, 0));
      
      const intersection = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.plane, intersection);
      
      if (intersection) {
        intersection.x = Math.max(-2, Math.min(2, intersection.x));
        intersection.y = Math.max(-2, Math.min(2, intersection.y));
        intersection.z = Math.max(-2, Math.min(2, intersection.z));
        
        this.externalForceCallback(intersection, 5000);
      }
    }
  }

  onMouseDown(event) {
    if (event.button === 0) {
      this.isDragging = true;
      this.onMouseMove(event);
    }
  }

  onMouseUp() {
    this.isDragging = false;
    if (this.externalForceCallback) {
      this.externalForceCallback(new THREE.Vector3(0, 0, 0), 0);
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateParticlePositions(physicsDevice, particleBuffer) {
    const positions = this.points.geometry.attributes.position.array;
    const readBuffer = physicsDevice.createBuffer({
      size: particleBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    const commandEncoder = physicsDevice.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      particleBuffer,
      0,
      readBuffer,
      0,
      particleBuffer.size
    );
    physicsDevice.queue.submit([commandEncoder.finish()]);
    
    return readBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Float32Array(readBuffer.getMappedRange());
      
      for (let i = 0; i < this.particleCount; i++) {
        const base = i * 11;
        positions[i * 3] = data[base];
        positions[i * 3 + 1] = data[base + 1];
        positions[i * 3 + 2] = data[base + 2];
      }
      
      this.points.geometry.attributes.position.needsUpdate = true;
      readBuffer.unmap();
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  setExternalForceCallback(callback) {
    this.externalForceCallback = callback;
  }

  dispose() {
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    
    this.renderer.dispose();
  }
}
