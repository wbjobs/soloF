import { vec3, mat4 } from 'gl-matrix';
import { CameraState } from './types';

export class OrbitCamera {
  private state: CameraState;
  private isDragging: boolean = false;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    initialState: Partial<CameraState> = {}
  ) {
    this.state = {
      distance: 5,
      theta: Math.PI / 4,
      phi: Math.PI / 4,
      target: [0, 0, 0],
      ...initialState
    };
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
  }

  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = e.clientX - this.lastX;
    const deltaY = e.clientY - this.lastY;

    this.state.theta -= deltaX * 0.01;
    this.state.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.state.phi + deltaY * 0.01));

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomSpeed = 0.001;
    this.state.distance = Math.max(2, Math.min(20, this.state.distance + e.deltaY * zoomSpeed));
  }

  getPosition(): vec3 {
    const x = this.state.distance * Math.sin(this.state.phi) * Math.cos(this.state.theta);
    const y = this.state.distance * Math.cos(this.state.phi);
    const z = this.state.distance * Math.sin(this.state.phi) * Math.sin(this.state.theta);
    return vec3.fromValues(
      x + this.state.target[0],
      y + this.state.target[1],
      z + this.state.target[2]
    );
  }

  getViewMatrix(): mat4 {
    const position = this.getPosition();
    const target = vec3.fromValues(...this.state.target);
    const up = vec3.fromValues(0, 1, 0);
    return mat4.lookAt(mat4.create(), position, target, up);
  }

  getProjectionMatrix(aspect: number): mat4 {
    return mat4.perspective(mat4.create(), Math.PI / 4, aspect, 0.1, 100);
  }

  getViewProjectionMatrix(aspect: number): mat4 {
    const view = this.getViewMatrix();
    const projection = this.getProjectionMatrix(aspect);
    return mat4.multiply(mat4.create(), projection, view);
  }
}
