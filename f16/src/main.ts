import './style.css';

const CONFIG = {
  PARTICLE_COUNT: 50000,
  GRID_SIZE: 128,
  TIME_STEP: 0.015,
  VISCOSITY: 0.1,
  DISSIPATION: 0.995,
  PRESSURE_ITERATIONS: 20,
  FORCE_RADIUS: 0.15,
  FORCE_STRENGTH: 5.0,
  VORTICITY_STRENGTH: 0.3,
  WORKGROUP_SIZE: 256
};

class FluidSimulator {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private width: number = 0;
  private height: number = 0;
  private format!: GPUTextureFormat;

  private velocityTexture!: GPUTexture;
  private velocityTexturePing!: GPUTexture;
  private pressureTexture!: GPUTexture;
  private pressureTexturePing!: GPUTexture;
  private divergenceTexture!: GPUTexture;
  private vorticityTexture!: GPUTexture;

  private particleBuffer!: GPUBuffer;
  private particleBufferPing!: GPUBuffer;

  private advectionPipeline!: GPUComputePipeline;
  private divergencePipeline!: GPUComputePipeline;
  private pressurePipeline!: GPUComputePipeline;
  private gradientSubtractionPipeline!: GPUComputePipeline;
  private vorticityPipeline!: GPUComputePipeline;
  private vorticityForcePipeline!: GPUComputePipeline;
  private particleUpdatePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;

  private advectionBindGroups: GPUBindGroup[] = [];
  private divergenceBindGroup!: GPUBindGroup;
  private pressureBindGroups: GPUBindGroup[] = [];
  private gradientBindGroups: GPUBindGroup[] = [];
  private vorticityBindGroups: GPUBindGroup[] = [];
  private vorticityForceBindGroups: GPUBindGroup[] = [];
  private particleUpdateBindGroups: GPUBindGroup[] = [];
  private renderBindGroups: GPUBindGroup[] = [];

  private mousePosition = { x: 0, y: 0 };
  private isMouseDown = false;
  private lastMousePosition = { x: 0, y: 0 };

  private uniformBuffer!: GPUBuffer;
  private mouseBuffer!: GPUBuffer;
  private materialBuffer!: GPUBuffer;

  private vorticityStrength = CONFIG.VORTICITY_STRENGTH;
  private materialType = 0;

  private fpsElement: HTMLElement;
  private particlesElement: HTMLElement;
  private computeTimeElement: HTMLElement;

  private frameCount = 0;
  private lastFpsTime = performance.now();

  private currentParticleBufferIndex = 0;

  constructor() {
    this.canvas = document.getElementById('fluidCanvas') as HTMLCanvasElement;
    this.fpsElement = document.getElementById('fps')!;
    this.particlesElement = document.getElementById('particles')!;
    this.computeTimeElement = document.getElementById('computeTime')!;
    this.setupUIControls();
  }

  private setupUIControls() {
    const vorticitySlider = document.getElementById('vorticitySlider') as HTMLInputElement;
    const vorticityValue = document.getElementById('vorticityValue')!;
    
    vorticitySlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      vorticityValue.textContent = value.toString();
      this.vorticityStrength = value / 100.0;
    });

    const smokeBtn = document.getElementById('smokeBtn')!;
    const inkBtn = document.getElementById('inkBtn')!;

    smokeBtn.addEventListener('click', () => {
      this.materialType = 0;
      smokeBtn.classList.add('active');
      inkBtn.classList.remove('active');
    });

    inkBtn.addEventListener('click', () => {
      this.materialType = 1;
      inkBtn.classList.add('active');
      smokeBtn.classList.remove('active');
    });
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported. Please use Chrome Canary or a WebGPU-enabled browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter.');
    }

    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: CONFIG.PARTICLE_COUNT * 16 * 2,
        maxBufferSize: CONFIG.PARTICLE_COUNT * 16 * 2
      }
    });

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = this.canvas.getContext('webgpu')!;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied'
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.setupMouseEvents();
    await this.createResources();
    await this.createPipelines();
    this.createBindGroups();
    this.initParticles();

    this.particlesElement.textContent = CONFIG.PARTICLE_COUNT.toString();
  }

  private resize() {
    const container = this.canvas.parentElement!;
    this.width = Math.min(container.clientWidth, 1200);
    this.height = Math.min(container.clientHeight, 768);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  private setupMouseEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.updateMousePosition(e);
      this.lastMousePosition = { ...this.mousePosition };
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isMouseDown) {
        this.lastMousePosition = { ...this.mousePosition };
        this.updateMousePosition(e);
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isMouseDown = false;
    });
  }

  private updateMousePosition(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.mousePosition = {
      x: (e.clientX - rect.left) / this.width,
      y: 1.0 - (e.clientY - rect.top) / this.height
    };
  }

  private createFloatTexture(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      size: [width, height],
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST
    });
  }

  private async createResources() {
    this.velocityTexture = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);
    this.velocityTexturePing = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);
    this.pressureTexture = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);
    this.pressureTexturePing = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);
    this.divergenceTexture = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);
    this.vorticityTexture = this.createFloatTexture(CONFIG.GRID_SIZE, CONFIG.GRID_SIZE);

    const particleSize = CONFIG.PARTICLE_COUNT * 16;
    this.particleBuffer = this.device.createBuffer({
      size: particleSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX
    });
    this.particleBufferPing = this.device.createBuffer({
      size: particleSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.mouseBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.materialBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  private async createPipelines() {
    const advectionShader = await this.loadShader('advection');
    const divergenceShader = await this.loadShader('divergence');
    const pressureShader = await this.loadShader('pressure');
    const gradientShader = await this.loadShader('gradient');
    const vorticityShader = await this.loadShader('vorticity');
    const vorticityForceShader = await this.loadShader('vorticityForce');
    const particleUpdateShader = await this.loadShader('particleUpdate');
    const renderShader = await this.loadShader('render');

    this.advectionPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: advectionShader,
        entryPoint: 'main'
      }
    });

    this.divergencePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: divergenceShader,
        entryPoint: 'main'
      }
    });

    this.pressurePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: pressureShader,
        entryPoint: 'main'
      }
    });

    this.gradientSubtractionPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: gradientShader,
        entryPoint: 'main'
      }
    });

    this.vorticityPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: vorticityShader,
        entryPoint: 'main'
      }
    });

    this.vorticityForcePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: vorticityForceShader,
        entryPoint: 'main'
      }
    });

    this.particleUpdatePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: particleUpdateShader,
        entryPoint: 'main'
      }
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 16,
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'float32x4'
          }]
        }]
      },
      fragment: {
        module: renderShader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add'
            }
          }
        }]
      },
      primitive: {
        topology: 'point-list'
      }
    });
  }

  private async loadShader(name: string): Promise<GPUShaderModule> {
    const response = await fetch(`./src/shaders/${name}.wgsl`);
    const code = await response.text();
    return this.device.createShaderModule({ code });
  }

  private createBindGroups() {
    this.advectionBindGroups[0] = this.device.createBindGroup({
      layout: this.advectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexture.createView() },
        { binding: 1, resource: this.velocityTexturePing.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.mouseBuffer, offset: 0, size: 16 } },
        { binding: 4, resource: { buffer: this.mouseBuffer, offset: 16, size: 16 } }
      ]
    });

    this.advectionBindGroups[1] = this.device.createBindGroup({
      layout: this.advectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexturePing.createView() },
        { binding: 1, resource: this.velocityTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.mouseBuffer, offset: 0, size: 16 } },
        { binding: 4, resource: { buffer: this.mouseBuffer, offset: 16, size: 16 } }
      ]
    });

    this.divergenceBindGroup = this.device.createBindGroup({
      layout: this.divergencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexture.createView() },
        { binding: 1, resource: this.divergenceTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.pressureBindGroups[0] = this.device.createBindGroup({
      layout: this.pressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.divergenceTexture.createView() },
        { binding: 1, resource: this.pressureTexture.createView() },
        { binding: 2, resource: this.pressureTexturePing.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.pressureBindGroups[1] = this.device.createBindGroup({
      layout: this.pressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.divergenceTexture.createView() },
        { binding: 1, resource: this.pressureTexturePing.createView() },
        { binding: 2, resource: this.pressureTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.gradientBindGroups[0] = this.device.createBindGroup({
      layout: this.gradientSubtractionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexture.createView() },
        { binding: 1, resource: this.pressureTexture.createView() },
        { binding: 2, resource: this.velocityTexturePing.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.gradientBindGroups[1] = this.device.createBindGroup({
      layout: this.gradientSubtractionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexturePing.createView() },
        { binding: 1, resource: this.pressureTexture.createView() },
        { binding: 2, resource: this.velocityTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.vorticityBindGroups[0] = this.device.createBindGroup({
      layout: this.vorticityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexture.createView() },
        { binding: 1, resource: this.vorticityTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.vorticityBindGroups[1] = this.device.createBindGroup({
      layout: this.vorticityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.velocityTexturePing.createView() },
        { binding: 1, resource: this.vorticityTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.vorticityForceBindGroups[0] = this.device.createBindGroup({
      layout: this.vorticityForcePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.vorticityTexture.createView() },
        { binding: 1, resource: this.velocityTexture.createView() },
        { binding: 2, resource: this.velocityTexturePing.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.vorticityForceBindGroups[1] = this.device.createBindGroup({
      layout: this.vorticityForcePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.vorticityTexture.createView() },
        { binding: 1, resource: this.velocityTexturePing.createView() },
        { binding: 2, resource: this.velocityTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.particleUpdateBindGroups[0] = this.device.createBindGroup({
      layout: this.particleUpdatePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.particleBufferPing } },
        { binding: 2, resource: this.velocityTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.particleUpdateBindGroups[1] = this.device.createBindGroup({
      layout: this.particleUpdatePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBufferPing } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
        { binding: 2, resource: this.velocityTexturePing.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });

    this.renderBindGroups[0] = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.materialBuffer } }
      ]
    });
  }

  private initParticles() {
    const particles = new Float32Array(CONFIG.PARTICLE_COUNT * 4);
    for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
      particles[i * 4] = Math.random();
      particles[i * 4 + 1] = Math.random();
      particles[i * 4 + 2] = (Math.random() - 0.5) * 0.05;
      particles[i * 4 + 3] = (Math.random() - 0.5) * 0.05;
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, particles);
  }

  private updateUniforms() {
    const uniforms = new Float32Array([
      CONFIG.GRID_SIZE,
      CONFIG.GRID_SIZE,
      CONFIG.TIME_STEP,
      this.vorticityStrength
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const mouseData = new Float32Array([
      this.mousePosition.x * CONFIG.GRID_SIZE,
      this.mousePosition.y * CONFIG.GRID_SIZE,
      (this.mousePosition.x - this.lastMousePosition.x) * CONFIG.FORCE_STRENGTH * CONFIG.GRID_SIZE,
      (this.mousePosition.y - this.lastMousePosition.y) * CONFIG.FORCE_STRENGTH * CONFIG.GRID_SIZE,
      CONFIG.FORCE_RADIUS * CONFIG.GRID_SIZE,
      this.isMouseDown ? 1.0 : 0.0,
      0,
      0
    ]);
    this.device.queue.writeBuffer(this.mouseBuffer, 0, mouseData);

    const materialData = new Float32Array([
      this.materialType,
      this.materialType === 0 ? 0.08 : 0.12,
      this.materialType === 0 ? 0.25 : 0.35,
      0
    ]);
    this.device.queue.writeBuffer(this.materialBuffer, 0, materialData);
  }

  private dispatchCompute(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup, workgroupsX: number, workgroupsY: number = 1) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
  }

  async run() {
    let velocityPingPong = 0;
    let pressurePingPong = 0;

    const render = () => {
      const startTime = performance.now();

      this.updateUniforms();

      const encoder = this.device.createCommandEncoder();

      this.dispatchCompute(encoder, this.advectionPipeline, this.advectionBindGroups[velocityPingPong], Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));
      velocityPingPong = 1 - velocityPingPong;

      this.dispatchCompute(encoder, this.divergencePipeline, this.divergenceBindGroup, Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));

      for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
        this.dispatchCompute(encoder, this.pressurePipeline, this.pressureBindGroups[pressurePingPong], Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));
        pressurePingPong = 1 - pressurePingPong;
      }

      this.dispatchCompute(encoder, this.gradientSubtractionPipeline, this.gradientBindGroups[velocityPingPong], Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));
      velocityPingPong = 1 - velocityPingPong;

      if (this.vorticityStrength > 0.01) {
        this.dispatchCompute(encoder, this.vorticityPipeline, this.vorticityBindGroups[velocityPingPong], Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));
        
        this.dispatchCompute(encoder, this.vorticityForcePipeline, this.vorticityForceBindGroups[velocityPingPong], Math.ceil(CONFIG.GRID_SIZE / 8), Math.ceil(CONFIG.GRID_SIZE / 8));
        velocityPingPong = 1 - velocityPingPong;
      }

      this.dispatchCompute(encoder, this.particleUpdatePipeline, this.particleUpdateBindGroups[this.currentParticleBufferIndex], Math.ceil(CONFIG.PARTICLE_COUNT / CONFIG.WORKGROUP_SIZE));
      this.currentParticleBufferIndex = 1 - this.currentParticleBufferIndex;

      const currentParticleBuffer = this.currentParticleBufferIndex === 0 ? this.particleBuffer : this.particleBufferPing;

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 }
        }]
      });
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroups[0]);
      renderPass.setVertexBuffer(0, currentParticleBuffer);
      renderPass.draw(CONFIG.PARTICLE_COUNT);
      renderPass.end();

      this.device.queue.submit([encoder.finish()]);

      const computeTime = performance.now() - startTime;
      this.computeTimeElement.textContent = computeTime.toFixed(2);

      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsTime >= 1000) {
        this.fpsElement.textContent = this.frameCount.toString();
        this.frameCount = 0;
        this.lastFpsTime = now;
      }

      requestAnimationFrame(render);
    };

    render();
  }
}

async function main() {
  const simulator = new FluidSimulator();
  try {
    await simulator.init();
    await simulator.run();
  } catch (error) {
    console.error('Failed to initialize fluid simulator:', error);
    alert(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

main();
