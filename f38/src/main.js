import { SPHPhysics } from './physics/SPHPhysics.js';
import { FluidRenderer } from './renderer/FluidRenderer.js';

const PARTICLE_COUNT = 1024;
const FIXED_DT = 0.005;

class FluidSimulation {
  constructor() {
    this.physics = null;
    this.renderer = null;
    this.isRunning = false;
    this.accumulator = 0;
    this.lastTime = 0;
    
    this.init();
  }

  async init() {
    if (!navigator.gpu) {
      alert('WebGPU is not supported in your browser. Please use a browser that supports WebGPU.');
      return;
    }

    document.getElementById('particleCount').textContent = PARTICLE_COUNT;

    this.physics = new SPHPhysics(PARTICLE_COUNT);
    await this.physics.init();

    this.renderer = new FluidRenderer(document.body);
    await this.renderer.init(PARTICLE_COUNT);

    this.renderer.setExternalForceCallback((position, force) => {
      this.physics.setMouseForce(position, force);
    });

    this.setupControls();

    this.start();
  }

  setupControls() {
    const viscositySlider = document.getElementById('viscositySlider');
    const viscosityValue = document.getElementById('viscosityValue');
    viscositySlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.physics.setViscosity(value);
      viscosityValue.textContent = value.toFixed(0);
    });

    const densitySlider = document.getElementById('densitySlider');
    const densityValue = document.getElementById('densityValue');
    densitySlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.physics.setRestDensity(value);
      densityValue.textContent = value.toFixed(0);
    });

    const gasSlider = document.getElementById('gasSlider');
    const gasValue = document.getElementById('gasValue');
    gasSlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.physics.setGasConstant(value);
      gasValue.textContent = value.toFixed(0);
    });
  }

  start() {
    this.isRunning = true;
    this.lastTime = performance.now() / 1000;
    this.animate();
  }

  animate() {
    if (!this.isRunning) return;

    requestAnimationFrame(() => this.animate());

    const currentTime = performance.now() / 1000;
    const frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    this.accumulator += frameTime;
    
    while (this.accumulator >= FIXED_DT) {
      this.physics.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    this.renderer.updateParticlePositions(
      this.physics.device,
      this.physics.getParticleBuffer()
    ).then(() => {
      this.renderer.render();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new FluidSimulation();
});
