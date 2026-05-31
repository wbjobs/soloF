export interface GeoTIFFData {
  width: number;
  height: number;
  samples: number;
  bands: Float32Array[];
  bandNames: string[];
}

export interface NDVIResult {
  data: Float32Array;
  width: number;
  height: number;
  min: number;
  max: number;
  mean: number;
}
