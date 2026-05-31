import { vec3 } from 'gl-matrix';
import { OrbitCamera } from './camera';
import { SingleHeatmapData } from './types';

const VERTEX_SHADER = `
struct Uniforms {
  viewProjectionMatrix: mat4x4f,
  cameraPosition: vec3f,
  lightPosition: vec3f,
  lightIntensity: f32,
  sphereMaterial: vec4f,
  planeMaterial: vec4f,
  heatmapIntensity: f32,
  showHeatmap: f32,
  viewportSize: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heatmapSampler: sampler;
@group(0) @binding(2) var heatmapTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) materialIndex: f32,
}

@vertex
fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) materialIndex: f32) -> VertexOutput {
  var output: VertexOutput;
  output.worldPos = position;
  output.normal = normal;
  output.uv = uv;
  output.materialIndex = materialIndex;
  output.position = uniforms.viewProjectionMatrix * vec4f(position, 1.0);
  return output;
}

fn heatmapColor(value: f32) -> vec3f {
  if (value < 0.25) {
    return mix(vec3f(0.0, 0.0, 0.5), vec3f(0.0, 0.0, 1.0), value * 4.0);
  } else if (value < 0.5) {
    return mix(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 1.0), (value - 0.25) * 4.0);
  } else if (value < 0.75) {
    return mix(vec3f(0.0, 1.0, 1.0), vec3f(1.0, 1.0, 0.0), (value - 0.5) * 4.0);
  } else {
    return mix(vec3f(1.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), (value - 0.75) * 4.0);
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let viewDir = normalize(uniforms.cameraPosition - input.worldPos);
  let lightDir = normalize(uniforms.lightPosition - input.worldPos);
  let lightDist = length(uniforms.lightPosition - input.worldPos);
  
  let diffuse = max(dot(normal, lightDir), 0.0);
  let halfDir = normalize(lightDir + viewDir);
  let specular = pow(max(dot(normal, halfDir), 0.0), 32.0);
  
  var materialReflectivity: f32;
  var materialRoughness: f32;
  var baseColor: vec3f;
  
  if (input.materialIndex < 0.5) {
    materialReflectivity = uniforms.sphereMaterial.x;
    materialRoughness = uniforms.sphereMaterial.y;
    baseColor = vec3f(0.8, 0.3, 0.3);
  } else {
    materialReflectivity = uniforms.planeMaterial.x;
    materialRoughness = uniforms.planeMaterial.y;
    let checker = step(0.5, fract(input.uv.x * 4.0) * fract(input.uv.y * 4.0) + 0.5);
    baseColor = mix(vec3f(0.3, 0.3, 0.35), vec3f(0.6, 0.6, 0.65), checker);
  }
  
  let attenuation = 1.0 / (lightDist * lightDist);
  let lighting = (diffuse + specular * 0.5) * uniforms.lightIntensity * attenuation;
  var finalColor = baseColor * (0.1 + lighting * 0.9);
  
  if (uniforms.showHeatmap > 0.5) {
    let screenUV = input.position.xy / uniforms.viewportSize;
    screenUV.y = 1.0 - screenUV.y;
    let heatValue = textureSample(heatmapTexture, heatmapSampler, screenUV).r;
    let heatColor = heatmapColor(heatValue * uniforms.heatmapIntensity);
    finalColor = mix(finalColor, heatColor, clamp(heatValue * uniforms.heatmapIntensity * 0.7, 0.0, 0.7));
  }
  
  return vec4f(finalColor, 1.0);
}
`;

export class WebGPURenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;
  private vertexBuffer!: GPUBuffer;
  private indexBuffer!: GPUBuffer;
  private indexCount!: number;
  private heatmapTextures: GPUTexture[] = [];
  private heatmapSampler!: GPUSampler;
  private camera: OrbitCamera;
  private canvas: HTMLCanvasElement;
  private animationId!: number;

  public sphereReflectivity: number = 0.5;
  public sphereRoughness: number = 0.3;
  public planeReflectivity: number = 0.3;
  public planeRoughness: number = 0.8;
  public heatmapIntensity: number = 1.0;
  public showHeatmap: boolean = true;
  public currentBounce: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new OrbitCamera(canvas);
  }

  async init(): Promise<void> {
    const entry = navigator.gpu;
    if (!entry) {
      throw new Error('WebGPU 不受支持，请使用支持 WebGPU 的浏览器');
    }

    const adapter = await entry.requestAdapter();
    if (!adapter) {
      throw new Error('无法获取 GPU 适配器');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu')!;

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'opaque',
    });

    this.createGeometry();
    this.createUniforms();
    this.createHeatmapTexture();
    this.createPipeline(format);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private createGeometry(): void {
    const vertices: number[] = [];
    const indices: number[] = [];

    const sphere = this.createSphere(1.0, 32, 32, 0);
    vertices.push(...sphere.vertices);
    indices.push(...sphere.indices);

    const sphereVertexCount = sphere.vertices.length / 9;

    const plane = this.createPlane(10, 10, 20, 20, 1);
    vertices.push(...plane.vertices);
    for (const idx of plane.indices) {
      indices.push(idx + sphereVertexCount);
    }

    this.indexCount = indices.length;

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.length * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(vertices);
    this.vertexBuffer.unmap();

    this.indexBuffer = this.device.createBuffer({
      size: indices.length * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(indices);
    this.indexBuffer.unmap();
  }

  private createSphere(radius: number, latBands: number, longBands: number, materialIndex: number): { vertices: number[]; indices: number[] } {
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let lat = 0; lat <= latBands; lat++) {
      const theta = (lat * Math.PI) / latBands;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let lon = 0; lon <= longBands; lon++) {
        const phi = (lon * 2 * Math.PI) / longBands + Math.PI / 2;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        const x = cosPhi * sinTheta;
        const y = cosTheta;
        const z = sinPhi * sinTheta;
        const u = lon / longBands;
        const v = lat / latBands;

        vertices.push(
          x * radius, y * radius, z * radius,
          x, y, z,
          u, v,
          materialIndex
        );
      }
    }

    for (let lat = 0; lat < latBands; lat++) {
      for (let lon = 0; lon < longBands; lon++) {
        const first = lat * (longBands + 1) + lon;
        const second = first + longBands + 1;

        indices.push(first, second, first + 1);
        indices.push(second, second + 1, first + 1);
      }
    }

    return { vertices, indices };
  }

  private createPlane(width: number, depth: number, widthSegs: number, depthSegs: number, materialIndex: number): { vertices: number[]; indices: number[] } {
    const vertices: number[] = [];
    const indices: number[] = [];

    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    for (let z = 0; z <= depthSegs; z++) {
      for (let x = 0; x <= widthSegs; x++) {
        const px = (x / widthSegs) * width - halfWidth;
        const pz = (z / depthSegs) * depth - halfDepth;
        const u = x / widthSegs;
        const v = z / depthSegs;

        vertices.push(
          px, -1, pz,
          0, 1, 0,
          u, v,
          materialIndex
        );
      }
    }

    for (let z = 0; z < depthSegs; z++) {
      for (let x = 0; x < widthSegs; x++) {
        const first = z * (widthSegs + 1) + x;
        const second = first + widthSegs + 1;

        indices.push(first, second, first + 1);
        indices.push(second, second + 1, first + 1);
      }
    }

    return { vertices, indices };
  }

  private createUniforms(): void {
    const uniformSize = 256;
    this.uniformBuffer = this.device.createBuffer({
      size: uniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createHeatmapTexture(): void {
    const initialTexture = this.device.createTexture({
      size: [256, 256],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.heatmapTextures = [initialTexture];

    this.heatmapSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private createPipeline(format: GPUTextureFormat): void {
    const shaderModule = this.device.createShaderModule({
      code: VERTEX_SHADER,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 9 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.heatmapSampler },
        { binding: 2, resource: this.heatmapTextures[0].createView() },
      ],
    });
  }

  updateHeatmap(data: SingleHeatmapData): void {
    if (data.width <= 0 || data.height <= 0) {
      console.warn('Invalid heatmap dimensions:', data.width, data.height);
      return;
    }

    const expectedDataLength = data.width * data.height;
    if (data.data.length !== expectedDataLength) {
      console.warn(`Heatmap data length mismatch: expected ${expectedDataLength}, got ${data.data.length}`);
      return;
    }

    const currentTexture = this.heatmapTextures[0];
    const currentWidth = currentTexture.width;
    const currentHeight = currentTexture.height;

    if (data.width !== currentWidth || data.height !== currentHeight) {
      try {
        currentTexture.destroy();
      } catch (e) {
        console.warn('Failed to destroy old heatmap texture:', e);
      }

      const newTexture = this.device.createTexture({
        size: [data.width, data.height],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.heatmapTextures[0] = newTexture;

      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.heatmapSampler },
          { binding: 2, resource: newTexture.createView() },
        ],
      });
    }

    const floatData = new Float32Array(data.data);
    const bytesPerRow = Math.ceil((data.width * 4) / 256) * 256;

    this.device.queue.writeTexture(
      { texture: this.heatmapTextures[0], mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      floatData,
      { offset: 0, bytesPerRow, rowsPerImage: data.height },
      { width: data.width, height: data.height, depthOrArrayLayers: 1 }
    );
  }

  private updateUniforms(): void {
    const aspect = this.canvas.width / this.canvas.height;
    const viewProjection = this.camera.getViewProjectionMatrix(aspect);
    const cameraPos = this.camera.getPosition();

    const uniformData = new Float32Array(64);
    uniformData.set(viewProjection, 0);
    uniformData.set(cameraPos, 16);
    uniformData.set([5, 5, 5], 20);
    uniformData[23] = 100;
    uniformData[24] = this.sphereReflectivity;
    uniformData[25] = this.sphereRoughness;
    uniformData[28] = this.planeReflectivity;
    uniformData[29] = this.planeRoughness;
    uniformData[32] = this.heatmapIntensity;
    uniformData[33] = this.showHeatmap ? 1.0 : 0.0;
    uniformData[36] = this.canvas.width;
    uniformData[37] = this.canvas.height;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  }

  private render(): void {
    this.updateUniforms();

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(this.indexCount);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  start(): void {
    const animate = () => {
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  getCameraPosition(): vec3 {
    return this.camera.getPosition();
  }

  async exportToPNG(): Promise<string> {
    this.render();
    
    const texture = this.context.getCurrentTexture();
    const width = texture.width;
    const height = texture.height;
    
    const outputTexture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    const commandEncoder = this.device.createCommandEncoder();
    
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: this.device.createShaderModule({
          code: `
            @vertex
            fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
              var pos = array(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0)
              );
              return vec4f(pos[vi], 0.0, 1.0);
            }
          `,
        }),
        entryPoint: 'vs_main',
      },
      fragment: {
        module: this.device.createShaderModule({
          code: `
            @group(0) @binding(0) var tex: texture_2d<f32>;
            @fragment
            fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
              let uv = vec2f(pos.x / ${width}.0, 1.0 - pos.y / ${height}.0);
              return textureLoad(tex, vec2u(u32(pos.x), u32(${height} - 1 - pos.y)), 0);
            }
          `,
        }),
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
    
    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: texture.createView() }],
    });
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3);
    renderPass.end();
    
    const readBuffer = this.device.createBuffer({
      size: width * height * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    commandEncoder.copyTextureToBuffer(
      { texture: outputTexture },
      { buffer: readBuffer, bytesPerRow: width * 4 },
      { width, height }
    );
    
    this.device.queue.submit([commandEncoder.finish()]);
    
    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8ClampedArray(readBuffer.getMappedRange());
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);
    
    readBuffer.unmap();
    outputTexture.destroy();
    readBuffer.destroy();
    
    return canvas.toDataURL('image/png');
  }
}
