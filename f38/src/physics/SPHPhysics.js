const computeShaderCode = `
struct Particle {
  position: vec3<f32>,
  velocity: vec3<f32>,
  density: f32,
  pressure: f32,
  force: vec3<f32>,
}

struct Uniforms {
  deltaTime: f32,
  particleCount: u32,
  smoothingRadius: f32,
  restDensity: f32,
  gasConstant: f32,
  viscosity: f32,
  gravity: vec3<f32>,
  boundaryMin: vec3<f32>,
  boundaryMax: vec3<f32>,
  mousePosition: vec3<f32>,
  mouseForce: f32,
  mouseRadius: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

fn poly6Kernel(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2 = h * h;
  let r2 = r * r;
  let factor = 315.0 / (64.0 * 3.14159265359 * pow(h, 9.0));
  return factor * pow(h2 - r2, 3.0);
}

fn spikyKernelGradient(r: vec3<f32>, h: f32) -> vec3<f32> {
  let rLen = length(r);
  if (rLen > h || rLen < 0.0001) { return vec3<f32>(0.0); }
  let factor = -45.0 / (3.14159265359 * pow(h, 6.0));
  return normalize(r) * factor * pow(h - rLen, 2.0);
}

fn viscosityKernelLaplacian(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let factor = 45.0 / (3.14159265359 * pow(h, 6.0));
  return factor * (h - r);
}

fn boundaryRepulsionForce(
  pos: vec3<f32>,
  boundaryMin: vec3<f32>,
  boundaryMax: vec3<f32>,
  particleRadius: f32
) -> vec3<f32> {
  var force = vec3<f32>(0.0);
  let repulsionStrength = 50000.0;
  let repulsionDistance = 0.3;
  
  let minDist = pos - boundaryMin;
  let maxDist = boundaryMax - pos;
  
  if (minDist.x < repulsionDistance) {
    let t = minDist.x / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.x += f;
  }
  if (maxDist.x < repulsionDistance) {
    let t = maxDist.x / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.x -= f;
  }
  
  if (minDist.y < repulsionDistance) {
    let t = minDist.y / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.y += f;
  }
  if (maxDist.y < repulsionDistance) {
    let t = maxDist.y / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.y -= f;
  }
  
  if (minDist.z < repulsionDistance) {
    let t = minDist.z / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.z += f;
  }
  if (maxDist.z < repulsionDistance) {
    let t = maxDist.z / repulsionDistance;
    let f = (1.0 - t) * (1.0 - t) * repulsionStrength;
    force.z -= f;
  }
  
  return force;
}

@compute @workgroup_size(64)
fn computeDensityPressure(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i = globalId.x;
  if (i >= uniforms.particleCount) { return; }
  
  var density = 0.0;
  let pi = particles[i].position;
  
  for (var j: u32 = 0; j < uniforms.particleCount; j++) {
    let pj = particles[j].position;
    let r = length(pi - pj);
    density += poly6Kernel(r, uniforms.smoothingRadius);
  }
  
  particles[i].density = density;
  particles[i].pressure = uniforms.gasConstant * (density - uniforms.restDensity);
}

@compute @workgroup_size(64)
fn computeForces(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i = globalId.x;
  if (i >= uniforms.particleCount) { return; }
  
  var pressureForce = vec3<f32>(0.0);
  var viscosityForce = vec3<f32>(0.0);
  
  let pi = particles[i].position;
  let vi = particles[i].velocity;
  let rhoI = particles[i].density;
  let pI = particles[i].pressure;
  
  for (var j: u32 = 0; j < uniforms.particleCount; j++) {
    if (i == j) { continue; }
    
    let pj = particles[j].position;
    let vj = particles[j].velocity;
    let rhoJ = particles[j].density;
    let pJ = particles[j].pressure;
    
    let r = pi - pj;
    let rLen = length(r);
    
    if (rLen < 0.0001 || rLen > uniforms.smoothingRadius) { continue; }
    
    let pressureTerm = (pI + pJ) / (2.0 * rhoJ);
    pressureForce += -pressureTerm * spikyKernelGradient(r, uniforms.smoothingRadius);
    
    let viscosityTerm = (vj - vi) / rhoJ;
    viscosityForce += uniforms.viscosity * viscosityTerm * viscosityKernelLaplacian(rLen, uniforms.smoothingRadius);
  }
  
  let gravityForce = uniforms.gravity * rhoI;
  var totalForce = pressureForce + viscosityForce + gravityForce;
  
  let boundaryForce = boundaryRepulsionForce(
    pi,
    uniforms.boundaryMin,
    uniforms.boundaryMax,
    0.05
  );
  totalForce += boundaryForce;
  
  let mouseDist = length(pi - uniforms.mousePosition);
  if (mouseDist < uniforms.mouseRadius && uniforms.mouseForce > 0.0) {
    let dir = normalize(pi - uniforms.mousePosition);
    let falloff = 1.0 - mouseDist / uniforms.mouseRadius;
    totalForce += dir * uniforms.mouseForce * falloff * falloff;
  }
  
  particles[i].force = totalForce;
}

fn handleCollision(
  pos: vec3<f32>,
  vel: vec3<f32>,
  boundaryMin: vec3<f32>,
  boundaryMax: vec3<f32>,
  particleRadius: f32
) -> vec2<vec3<f32>> {
  var newPos = pos;
  var newVel = vel;
  
  let restitution = 0.3;
  let friction = 0.1;
  
  let minBound = boundaryMin + vec3<f32>(particleRadius);
  let maxBound = boundaryMax - vec3<f32>(particleRadius);
  
  if (newPos.x < minBound.x) {
    let penetration = minBound.x - newPos.x;
    newPos.x += 2.0 * penetration;
    newVel.x = -newVel.x * restitution;
    newVel.y *= (1.0 - friction);
    newVel.z *= (1.0 - friction);
  }
  if (newPos.x > maxBound.x) {
    let penetration = newPos.x - maxBound.x;
    newPos.x -= 2.0 * penetration;
    newVel.x = -newVel.x * restitution;
    newVel.y *= (1.0 - friction);
    newVel.z *= (1.0 - friction);
  }
  
  if (newPos.y < minBound.y) {
    let penetration = minBound.y - newPos.y;
    newPos.y += 2.0 * penetration;
    newVel.y = -newVel.y * restitution;
    newVel.x *= (1.0 - friction);
    newVel.z *= (1.0 - friction);
  }
  if (newPos.y > maxBound.y) {
    let penetration = newPos.y - maxBound.y;
    newPos.y -= 2.0 * penetration;
    newVel.y = -newVel.y * restitution;
    newVel.x *= (1.0 - friction);
    newVel.z *= (1.0 - friction);
  }
  
  if (newPos.z < minBound.z) {
    let penetration = minBound.z - newPos.z;
    newPos.z += 2.0 * penetration;
    newVel.z = -newVel.z * restitution;
    newVel.x *= (1.0 - friction);
    newVel.y *= (1.0 - friction);
  }
  if (newPos.z > maxBound.z) {
    let penetration = newPos.z - maxBound.z;
    newPos.z -= 2.0 * penetration;
    newVel.z = -newVel.z * restitution;
    newVel.x *= (1.0 - friction);
    newVel.y *= (1.0 - friction);
  }
  
  return vec2<vec3<f32>>(newPos, newVel);
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i = globalId.x;
  if (i >= uniforms.particleCount) { return; }
  
  var vel = particles[i].velocity;
  var pos = particles[i].position;
  let force = particles[i].force;
  let rho = max(particles[i].density, 0.001);
  
  vel += (force / rho) * uniforms.deltaTime;
  vel *= 0.99;
  pos += vel * uniforms.deltaTime;
  
  let particleRadius = 0.05;
  let result = handleCollision(
    pos, vel,
    uniforms.boundaryMin,
    uniforms.boundaryMax,
    particleRadius
  );
  pos = result[0];
  vel = result[1];
  
  particles[i].position = pos;
  particles[i].velocity = vel;
}
`;

export class SPHPhysics {
  constructor(particleCount = 1024) {
    this.particleCount = particleCount;
    this.device = null;
    this.particleBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.densityPipeline = null;
    this.forcePipeline = null;
    this.integratePipeline = null;
    
    this.params = {
      smoothingRadius: 0.15,
      restDensity: 1000.0,
      gasConstant: 2000.0,
      viscosity: 100.0,
      gravity: [0, -9.8, 0],
      boundaryMin: [-2, -2, -2],
      boundaryMax: [2, 2, 2],
    };
    
    this.mouseData = {
      position: [0, 0, 0],
      force: 0,
      radius: 0.5,
    };
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
    
    this.createBuffers();
    this.createPipelines();
    this.initializeParticles();
  }

  createBuffers() {
    const particleSize = 3 + 3 + 1 + 1 + 3;
    const particleBufferSize = this.particleCount * particleSize * 4;
    
    this.particleBuffer = this.device.createBuffer({
      size: particleBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    
    this.uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createPipelines() {
    const shaderModule = this.device.createShaderModule({
      code: computeShaderCode,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.densityPipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'computeDensityPressure' },
    });

    this.forcePipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'computeForces' },
    });

    this.integratePipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'integrate' },
    });
  }

  initializeParticles() {
    const particleData = new Float32Array(this.particleCount * 11);
    
    const gridSize = Math.ceil(Math.cbrt(this.particleCount));
    const spacing = 0.1;
    const offset = -gridSize * spacing / 2;
    
    let idx = 0;
    for (let x = 0; x < gridSize && idx < this.particleCount; x++) {
      for (let y = 0; y < gridSize && idx < this.particleCount; y++) {
        for (let z = 0; z < gridSize && idx < this.particleCount; z++) {
          const base = idx * 11;
          particleData[base + 0] = offset + x * spacing + (Math.random() - 0.5) * 0.02;
          particleData[base + 1] = offset + y * spacing + 1.5 + (Math.random() - 0.5) * 0.02;
          particleData[base + 2] = offset + z * spacing + (Math.random() - 0.5) * 0.02;
          
          particleData[base + 3] = 0;
          particleData[base + 4] = 0;
          particleData[base + 5] = 0;
          
          particleData[base + 6] = 1000;
          particleData[base + 7] = 0;
          
          particleData[base + 8] = 0;
          particleData[base + 9] = 0;
          particleData[base + 10] = 0;
          
          idx++;
        }
      }
    }
    
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
  }

  updateUniforms(deltaTime) {
    const uniformData = new Float32Array(64);
    
    uniformData[0] = deltaTime;
    uniformData[1] = this.particleCount;
    uniformData[2] = this.params.smoothingRadius;
    uniformData[3] = this.params.restDensity;
    uniformData[4] = this.params.gasConstant;
    uniformData[5] = this.params.viscosity;
    
    uniformData[8] = this.params.gravity[0];
    uniformData[9] = this.params.gravity[1];
    uniformData[10] = this.params.gravity[2];
    
    uniformData[16] = this.params.boundaryMin[0];
    uniformData[17] = this.params.boundaryMin[1];
    uniformData[18] = this.params.boundaryMin[2];
    
    uniformData[24] = this.params.boundaryMax[0];
    uniformData[25] = this.params.boundaryMax[1];
    uniformData[26] = this.params.boundaryMax[2];
    
    uniformData[32] = this.mouseData.position[0];
    uniformData[33] = this.mouseData.position[1];
    uniformData[34] = this.mouseData.position[2];
    uniformData[35] = this.mouseData.force;
    uniformData[36] = this.mouseData.radius;
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  step(deltaTime) {
    this.updateUniforms(deltaTime);
    
    const workgroupCount = Math.ceil(this.particleCount / 64);
    
    const commandEncoder = this.device.createCommandEncoder();
    
    const densityPass = commandEncoder.beginComputePass();
    densityPass.setPipeline(this.densityPipeline);
    densityPass.setBindGroup(0, this.bindGroup);
    densityPass.dispatchWorkgroups(workgroupCount);
    densityPass.end();
    
    const forcePass = commandEncoder.beginComputePass();
    forcePass.setPipeline(this.forcePipeline);
    forcePass.setBindGroup(0, this.bindGroup);
    forcePass.dispatchWorkgroups(workgroupCount);
    forcePass.end();
    
    const integratePass = commandEncoder.beginComputePass();
    integratePass.setPipeline(this.integratePipeline);
    integratePass.setBindGroup(0, this.bindGroup);
    integratePass.dispatchWorkgroups(workgroupCount);
    integratePass.end();
    
    this.device.queue.submit([commandEncoder.finish()]);
  }

  getParticleBuffer() {
    return this.particleBuffer;
  }

  setMouseForce(position, force) {
    this.mouseData.position = [position.x, position.y, position.z];
    this.mouseData.force = force;
  }

  setViscosity(value) {
    this.params.viscosity = value;
  }

  setRestDensity(value) {
    this.params.restDensity = value;
  }

  setGasConstant(value) {
    this.params.gasConstant = value;
  }

  getViscosity() {
    return this.params.viscosity;
  }

  getRestDensity() {
    return this.params.restDensity;
  }

  getGasConstant() {
    return this.params.gasConstant;
  }
}
