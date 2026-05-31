import * as THREE from 'three';
import {
  baseVertexShader,
  advectionShader,
  diffusionShader,
  pressureShader,
  divergenceShader,
  gradientSubtractShader,
  viscosityShader,
  mouseForceShader,
  coloredSmokeShader,
  smokeInjectShader,
  boundaryClearShader,
  multiEmitterShader,
  emitterVelocityShader,
} from '../shaders';

interface SimulationParams {
  viscosity: number;
  diffusion: number;
  timeStep: number;
  pressureIterations: number;
}

export interface SmokeEmitter {
  id: number;
  name: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  color: { r: number; g: number; b: number };
  strength: number;
  radius: number;
  enabled: boolean;
}

const DEFAULT_EMITTERS: SmokeEmitter[] = [
  {
    id: 1,
    name: '红色发射器',
    position: { x: 0.25, y: 0.5 },
    velocity: { x: 2, y: 1 },
    color: { r: 1, g: 0.2, b: 0.1 },
    strength: 0.03,
    radius: 25,
    enabled: true,
  },
  {
    id: 2,
    name: '蓝色发射器',
    position: { x: 0.75, y: 0.5 },
    velocity: { x: -2, y: 1 },
    color: { r: 0.1, g: 0.3, b: 1 },
    strength: 0.03,
    radius: 25,
    enabled: true,
  },
  {
    id: 3,
    name: '绿色发射器',
    position: { x: 0.5, y: 0.25 },
    velocity: { x: 0, y: 2 },
    color: { r: 0.1, g: 1, b: 0.3 },
    strength: 0.025,
    radius: 20,
    enabled: false,
  },
  {
    id: 4,
    name: '黄色发射器',
    position: { x: 0.5, y: 0.75 },
    velocity: { x: 0, y: -2 },
    color: { r: 1, g: 0.9, b: 0.1 },
    strength: 0.025,
    radius: 20,
    enabled: false,
  },
  {
    id: 5,
    name: '紫色发射器',
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    color: { r: 0.8, g: 0.2, b: 1 },
    strength: 0.02,
    radius: 30,
    enabled: false,
  },
];

export class FluidSimulation {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  
  private resolution: number;
  
  private velocity: THREE.WebGLRenderTarget;
  private velocity2: THREE.WebGLRenderTarget;
  private density: THREE.WebGLRenderTarget;
  private density2: THREE.WebGLRenderTarget;
  private pressure: THREE.WebGLRenderTarget;
  private pressure2: THREE.WebGLRenderTarget;
  private divergence: THREE.WebGLRenderTarget;
  
  private advectionMaterial: THREE.ShaderMaterial;
  private diffusionMaterial: THREE.ShaderMaterial;
  private pressureMaterial: THREE.ShaderMaterial;
  private divergenceMaterial: THREE.ShaderMaterial;
  private gradientSubtractMaterial: THREE.ShaderMaterial;
  private viscosityMaterial: THREE.ShaderMaterial;
  private mouseForceMaterial: THREE.ShaderMaterial;
  private smokeRenderMaterial: THREE.ShaderMaterial;
  private smokeInjectMaterial: THREE.ShaderMaterial;
  private boundaryClearMaterial: THREE.ShaderMaterial;
  private multiEmitterMaterial: THREE.ShaderMaterial;
  private emitterVelocityMaterial: THREE.ShaderMaterial;
  
  private quad: THREE.Mesh;
  private outputMesh: THREE.Mesh;
  private emitterMarkers: THREE.Mesh[] = [];
  
  private mouseX = 0;
  private mouseY = 0;
  private mouseDX = 0;
  private mouseDY = 0;
  private isMouseDown = false;
  private draggingEmitterId: number | null = null;
  
  private params: SimulationParams;
  private emitters: SmokeEmitter[];
  private frameCount = 0;
  private resetThreshold = 1000;

  constructor(container: HTMLElement, resolution = 512) {
    this.resolution = resolution;
    this.params = {
      viscosity: 0.0001,
      diffusion: 0.0001,
      timeStep: 0.05,
      pressureIterations: 20,
    };
    this.emitters = JSON.parse(JSON.stringify(DEFAULT_EMITTERS));
    
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    this.renderer = new THREE.WebGLRenderer({ 
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(1);
    container.appendChild(this.renderer.domElement);
    
    this.velocity = this.createRenderTarget();
    this.velocity2 = this.createRenderTarget();
    this.density = this.createRenderTarget();
    this.density2 = this.createRenderTarget();
    this.pressure = this.createRenderTarget();
    this.pressure2 = this.createRenderTarget();
    this.divergence = this.createRenderTarget();
    
    this.createMaterials();
    this.createEmitterMarkers();
    
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry, this.advectionMaterial);
    
    this.outputMesh = new THREE.Mesh(geometry, this.smokeRenderMaterial);
    this.scene.add(this.outputMesh);
    
    this.setupEventListeners(container);
    this.initializeDensity();
    this.clearVelocity();
  }

  private createRenderTarget(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private createMaterials(): void {
    const resolutionVec = new THREE.Vector2(this.resolution, this.resolution);
    
    this.advectionMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: advectionShader,
      uniforms: {
        uVelocity: { value: null },
        uSource: { value: null },
        uResolution: { value: resolutionVec },
        uTimeStep: { value: this.params.timeStep },
        uDissipation: { value: 0.995 },
      },
    });
    
    this.diffusionMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: diffusionShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: resolutionVec },
        uDiffusion: { value: this.params.diffusion },
      },
    });
    
    this.pressureMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: pressureShader,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: null },
        uResolution: { value: resolutionVec },
      },
    });
    
    this.divergenceMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: divergenceShader,
      uniforms: {
        uVelocity: { value: null },
        uResolution: { value: resolutionVec },
      },
    });
    
    this.gradientSubtractMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: gradientSubtractShader,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        uResolution: { value: resolutionVec },
      },
    });
    
    this.viscosityMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: viscosityShader,
      uniforms: {
        uVelocity: { value: null },
        uResolution: { value: resolutionVec },
        uViscosity: { value: this.params.viscosity },
      },
    });
    
    this.mouseForceMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: mouseForceShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: resolutionVec },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uMouseDelta: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 20 },
        uStrength: { value: 0.5 },
      },
    });
    
    this.smokeRenderMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: coloredSmokeShader,
      uniforms: {
        uDensity: { value: null },
      },
    });
    
    this.smokeInjectMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: smokeInjectShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: resolutionVec },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 20 },
        uStrength: { value: 0.05 },
      },
    });
    
    this.boundaryClearMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: boundaryClearShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: resolutionVec },
        uBoundaryWidth: { value: 2.0 },
      },
    });
    
    this.multiEmitterMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: multiEmitterShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: resolutionVec },
        uPositions: { value: new Array(5).fill(null).map(() => new THREE.Vector2()) },
        uColors: { value: new Array(5).fill(null).map(() => new THREE.Color()) },
        uStrengths: { value: new Array(5).fill(0) },
        uRadii: { value: new Array(5).fill(0) },
        uActiveCount: { value: 0 },
      },
    });
    
    this.emitterVelocityMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: emitterVelocityShader,
      uniforms: {
        uVelocity: { value: null },
        uResolution: { value: resolutionVec },
        uPositions: { value: new Array(5).fill(null).map(() => new THREE.Vector2()) },
        uVelocities: { value: new Array(5).fill(null).map(() => new THREE.Vector2()) },
        uStrengths: { value: new Array(5).fill(0) },
        uRadii: { value: new Array(5).fill(0) },
        uActiveCount: { value: 0 },
      },
    });
  }

  private createEmitterMarkers(): void {
    this.emitterMarkers.forEach(marker => this.scene.remove(marker));
    this.emitterMarkers = [];
    
    this.emitters.forEach((emitter) => {
      if (!emitter.enabled) return;
      
      const geometry = new THREE.CircleGeometry(0.02, 32);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(emitter.color.r, emitter.color.g, emitter.color.b),
        transparent: true,
        opacity: 0.8,
      });
      const marker = new THREE.Mesh(geometry, material);
      
      const x = emitter.position.x * 2 - 1;
      const y = emitter.position.y * 2 - 1;
      marker.position.set(x, y, 0.5);
      
      this.scene.add(marker);
      this.emitterMarkers.push(marker);
    });
  }

  private setupEventListeners(container: HTMLElement): void {
    container.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.updateMousePosition(e, container);
    });
    
    container.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      this.draggingEmitterId = null;
    });
    
    container.addEventListener('mouseleave', () => {
      this.isMouseDown = false;
      this.draggingEmitterId = null;
    });
    
    container.addEventListener('mousemove', (e) => {
      if (this.isMouseDown) {
        const rect = container.getBoundingClientRect();
        const scaleX = this.resolution / rect.width;
        const scaleY = this.resolution / rect.height;
        
        const newX = (e.clientX - rect.left) * scaleX;
        const newY = (rect.height - (e.clientY - rect.top)) * scaleY;
        
        this.mouseDX = (newX - this.mouseX) * 0.5;
        this.mouseDY = (newY - this.mouseY) * 0.5;
        this.mouseX = newX;
        this.mouseY = newY;
      }
    });
  }

  private updateMousePosition(e: MouseEvent, container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    const scaleX = this.resolution / rect.width;
    const scaleY = this.resolution / rect.height;
    
    this.mouseX = (e.clientX - rect.left) * scaleX;
    this.mouseY = (rect.height - (e.clientY - rect.top)) * scaleY;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  private initializeDensity(): void {
    const size = this.resolution * this.resolution * 4;
    const data = new Float32Array(size);
    this.quad.material = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `,
    });
    
    this.renderer.setRenderTarget(this.density);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private clearVelocity(): void {
    const clearMaterial = new THREE.ShaderMaterial({
      vertexShader: baseVertexShader,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
      `,
    });
    
    this.quad.material = clearMaterial;
    this.renderer.setRenderTarget(this.velocity);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private swap(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    return [b, a];
  }

  private applyBoundary(target: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    this.boundaryClearMaterial.uniforms.uTexture.value = target.texture;
    this.quad.material = this.boundaryClearMaterial;
    this.renderer.setRenderTarget(output);
    this.renderer.render(this.scene, this.camera);
  }

  private applyEmitters(): void {
    const activeEmitters = this.emitters.filter(e => e.enabled);
    
    if (activeEmitters.length === 0) return;
    
    const positions = this.multiEmitterMaterial.uniforms.uPositions.value as THREE.Vector2[];
    const colors = this.multiEmitterMaterial.uniforms.uColors.value as THREE.Color[];
    const strengths = this.multiEmitterMaterial.uniforms.uStrengths.value as number[];
    const radii = this.multiEmitterMaterial.uniforms.uRadii.value as number[];
    const velPositions = this.emitterVelocityMaterial.uniforms.uPositions.value as THREE.Vector2[];
    const velocities = this.emitterVelocityMaterial.uniforms.uVelocities.value as THREE.Vector2[];
    const velStrengths = this.emitterVelocityMaterial.uniforms.uStrengths.value as number[];
    const velRadii = this.emitterVelocityMaterial.uniforms.uRadii.value as number[];
    
    activeEmitters.forEach((emitter, i) => {
      positions[i].set(emitter.position.x * this.resolution, emitter.position.y * this.resolution);
      colors[i].setRGB(emitter.color.r, emitter.color.g, emitter.color.b);
      strengths[i] = emitter.strength;
      radii[i] = emitter.radius;
      
      velPositions[i].set(emitter.position.x * this.resolution, emitter.position.y * this.resolution);
      velocities[i].set(emitter.velocity.x, emitter.velocity.y);
      velStrengths[i] = emitter.strength * 50;
      velRadii[i] = emitter.radius * 1.5;
    });
    
    this.multiEmitterMaterial.uniforms.uActiveCount.value = activeEmitters.length;
    this.multiEmitterMaterial.uniforms.uTexture.value = this.density.texture;
    this.quad.material = this.multiEmitterMaterial;
    this.renderer.setRenderTarget(this.density2);
    this.renderer.render(this.scene, this.camera);
    [this.density, this.density2] = this.swap(this.density, this.density2);
    
    this.emitterVelocityMaterial.uniforms.uActiveCount.value = activeEmitters.length;
    this.emitterVelocityMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.quad.material = this.emitterVelocityMaterial;
    this.renderer.setRenderTarget(this.velocity2);
    this.renderer.render(this.scene, this.camera);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
  }

  public update(): void {
    this.frameCount++;
    
    this.viscosityMaterial.uniforms.uViscosity.value = this.params.viscosity;
    this.diffusionMaterial.uniforms.uDiffusion.value = this.params.diffusion;
    this.advectionMaterial.uniforms.uTimeStep.value = this.params.timeStep;
    
    this.applyEmitters();
    
    if (this.isMouseDown && !this.draggingEmitterId) {
      this.mouseForceMaterial.uniforms.uMouse.value = new THREE.Vector2(this.mouseX, this.mouseY);
      this.mouseForceMaterial.uniforms.uMouseDelta.value = new THREE.Vector2(this.mouseDX, this.mouseDY);
      this.mouseForceMaterial.uniforms.uTexture.value = this.velocity.texture;
      this.quad.material = this.mouseForceMaterial;
      this.renderer.setRenderTarget(this.velocity2);
      this.renderer.render(this.scene, this.camera);
      [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
      
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    
    this.viscosityMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.quad.material = this.viscosityMaterial;
    this.renderer.setRenderTarget(this.velocity2);
    this.renderer.render(this.scene, this.camera);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.applyBoundary(this.velocity, this.velocity2);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.quad.material = this.divergenceMaterial;
    this.renderer.setRenderTarget(this.divergence);
    this.renderer.render(this.scene, this.camera);
    
    this.renderer.setRenderTarget(this.pressure);
    this.renderer.clear();
    
    for (let i = 0; i < this.params.pressureIterations; i++) {
      this.pressureMaterial.uniforms.uPressure.value = this.pressure.texture;
      this.pressureMaterial.uniforms.uDivergence.value = this.divergence.texture;
      this.quad.material = this.pressureMaterial;
      this.renderer.setRenderTarget(this.pressure2);
      this.renderer.render(this.scene, this.camera);
      [this.pressure, this.pressure2] = this.swap(this.pressure, this.pressure2);
    }
    
    this.applyBoundary(this.pressure, this.pressure2);
    [this.pressure, this.pressure2] = this.swap(this.pressure, this.pressure2);
    
    this.gradientSubtractMaterial.uniforms.uPressure.value = this.pressure.texture;
    this.gradientSubtractMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.quad.material = this.gradientSubtractMaterial;
    this.renderer.setRenderTarget(this.velocity2);
    this.renderer.render(this.scene, this.camera);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.applyBoundary(this.velocity, this.velocity2);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.advectionMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.advectionMaterial.uniforms.uSource.value = this.velocity.texture;
    this.quad.material = this.advectionMaterial;
    this.renderer.setRenderTarget(this.velocity2);
    this.renderer.render(this.scene, this.camera);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.applyBoundary(this.velocity, this.velocity2);
    [this.velocity, this.velocity2] = this.swap(this.velocity, this.velocity2);
    
    this.diffusionMaterial.uniforms.uTexture.value = this.density.texture;
    this.quad.material = this.diffusionMaterial;
    this.renderer.setRenderTarget(this.density2);
    this.renderer.render(this.scene, this.camera);
    [this.density, this.density2] = this.swap(this.density, this.density2);
    
    this.advectionMaterial.uniforms.uVelocity.value = this.velocity.texture;
    this.advectionMaterial.uniforms.uSource.value = this.density.texture;
    this.quad.material = this.advectionMaterial;
    this.renderer.setRenderTarget(this.density2);
    this.renderer.render(this.scene, this.camera);
    [this.density, this.density2] = this.swap(this.density, this.density2);
    
    if (this.frameCount % this.resetThreshold === 0) {
      this.frameCount = 0;
      this.clearVelocity();
    }
    
    this.smokeRenderMaterial.uniforms.uDensity.value = this.density.texture;
    this.outputMesh.material = this.smokeRenderMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  public setParams(params: Partial<SimulationParams>): void {
    this.params = { ...this.params, ...params };
  }

  public getEmitters(): SmokeEmitter[] {
    return this.emitters;
  }

  public updateEmitter(id: number, updates: Partial<SmokeEmitter>): void {
    const emitter = this.emitters.find(e => e.id === id);
    if (emitter) {
      Object.assign(emitter, updates);
      this.createEmitterMarkers();
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.renderer.dispose();
  }
}
