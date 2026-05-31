import { fromArrayBuffer } from 'geotiff';
import type { GeoTIFFData } from '../types';

export async function parseGeoTIFF(file: File): Promise<GeoTIFFData> {
  const arrayBuffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const width = image.getWidth();
  const height = image.getHeight();
  const samples = image.getSamplesPerPixel();
  
  const rasters = await image.readRasters();
  
  const bands: Float32Array[] = [];
  for (let i = 0; i < rasters.length; i++) {
    const raster = rasters[i] as Float32Array | Uint16Array | Uint8Array;
    const floatArray = new Float32Array(raster.length);
    for (let j = 0; j < raster.length; j++) {
      floatArray[j] = Number(raster[j]);
    }
    bands.push(floatArray);
  }
  
  const bandNames: string[] = [];
  for (let i = 0; i < bands.length; i++) {
    bandNames.push(`波段 ${i + 1}`);
  }
  
  return {
    width,
    height,
    samples,
    bands,
    bandNames,
  };
}

export function normalizeBand(band: Float32Array): Uint8ClampedArray {
  let min = Infinity;
  let max = -Infinity;
  
  for (let i = 0; i < band.length; i++) {
    if (band[i] < min) min = band[i];
    if (band[i] > max) max = band[i];
  }
  
  const range = max - min;
  const result = new Uint8ClampedArray(band.length);
  
  for (let i = 0; i < band.length; i++) {
    result[i] = Math.round(((band[i] - min) / range) * 255);
  }
  
  return result;
}
