declare module '@ndvi-wasm' {
  export default function init(): Promise<void>;
  export function calculate_ndvi(red: Float32Array, nir: Float32Array): Float32Array;
  export function calculate_ndvi_parallel(red: Float32Array, nir: Float32Array): Float32Array;
}
