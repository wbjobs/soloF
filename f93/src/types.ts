export interface Material {
  reflectivity: number;
  roughness: number;
  color: [number, number, number];
}

export interface Sphere {
  type: 'sphere';
  position: [number, number, number];
  radius: number;
  material: Material;
}

export interface Plane {
  type: 'plane';
  position: [number, number, number];
  normal: [number, number, number];
  material: Material;
}

export type Geometry = Sphere | Plane;

export interface PointLight {
  position: [number, number, number];
  intensity: number;
  color: [number, number, number];
}

export interface SceneDescription {
  geometries: Geometry[];
  lights: PointLight[];
  resolution: { width: number; height: number };
  samplesPerPixel: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
}

export interface BounceHeatmapData {
  bounce: number;
  data: number[];
  maxBrightness: number;
}

export interface SingleHeatmapData {
  width: number;
  height: number;
  data: number[];
  maxBrightness: number;
}

export interface HeatmapData {
  width: number;
  height: number;
  bounces: BounceHeatmapData[];
  cached: boolean;
}

export interface CameraState {
  distance: number;
  theta: number;
  phi: number;
  target: [number, number, number];
}

export interface Uniforms {
  viewProjectionMatrix: Float32Array;
  cameraPosition: Float32Array;
  lightPosition: Float32Array;
  lightIntensity: number;
  sphereMaterial: Float32Array;
  planeMaterial: Float32Array;
  heatmapIntensity: number;
  showHeatmap: number;
  viewportSize: [number, number];
}
