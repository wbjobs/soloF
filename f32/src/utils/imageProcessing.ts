export interface HistogramResult {
  histogram: Uint32Array;
  cdf: Float32Array;
  min: number;
  max: number;
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

export function calculateHistogram(
  data: Float32Array,
  bins: number = 256
): HistogramResult {
  const histogram = new Uint32Array(bins);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min || 1;

  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - min) / range;
    const binIndex = Math.min(Math.floor(normalized * bins), bins - 1);
    histogram[binIndex]++;
  }

  const cdf = new Float32Array(bins);
  let cumulative = 0;
  for (let i = 0; i < bins; i++) {
    cumulative += histogram[i];
    cdf[i] = cumulative / data.length;
  }

  return { histogram, cdf, min, max };
}

export function histogramEqualization(
  value: number,
  histogram: HistogramResult,
  contrast: number = 1.0
): number {
  const { cdf, min, max } = histogram;
  const bins = cdf.length;
  const range = max - min || 1;

  const normalized = (value - min) / range;
  const binIndex = Math.min(Math.floor(normalized * bins), bins - 1);

  const equalized = cdf[binIndex];

  const blended = normalized + (equalized - normalized) * contrast;

  return Math.max(0, Math.min(1, blended));
}

export function ndviToColor(
  ndvi: number,
  histogram: HistogramResult | null,
  contrast: number = 1.0
): [number, number, number] {
  let normalized = (ndvi + 1) / 2;

  if (histogram && contrast !== 0) {
    normalized = histogramEqualization(ndvi, histogram, contrast);
  }

  let r: number, g: number, b: number;

  if (normalized < 0.25) {
    const t = normalized / 0.25;
    r = 0;
    g = 0;
    b = Math.floor(128 + t * 127);
  } else if (normalized < 0.5) {
    const t = (normalized - 0.25) / 0.25;
    r = Math.floor(t * 255);
    g = 0;
    b = Math.floor(255 - t * 255);
  } else if (normalized < 0.75) {
    const t = (normalized - 0.5) / 0.25;
    r = 255;
    g = Math.floor(t * 255);
    b = 0;
  } else {
    const t = (normalized - 0.75) / 0.25;
    r = Math.floor(255 - t * 200);
    g = 255;
    b = 0;
  }

  return [r, g, b];
}

export function createColorGradientImageData(
  width: number,
  height: number,
  histogram: HistogramResult | null,
  contrast: number
): ImageData {
  const imageData = new ImageData(width, height);

  for (let x = 0; x < width; x++) {
    const ndvi = (x / width) * 2 - 1;
    const [r, g, b] = ndviToColor(ndvi, histogram, contrast);

    for (let y = 0; y < height; y++) {
      const pixelIndex = (y * width + x) * 4;
      imageData.data[pixelIndex] = r;
      imageData.data[pixelIndex + 1] = g;
      imageData.data[pixelIndex + 2] = b;
      imageData.data[pixelIndex + 3] = 255;
    }
  }

  return imageData;
}

export function renderNDVICanvas(
  ctx: CanvasRenderingContext2D,
  ndviData: Float32Array,
  width: number,
  height: number,
  histogram: HistogramResult | null,
  contrast: number
): void {
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < ndviData.length; i++) {
    const ndvi = ndviData[i];
    const [r, g, b] = ndviToColor(ndvi, histogram, contrast);
    const pixelIndex = i * 4;
    imageData.data[pixelIndex] = r;
    imageData.data[pixelIndex + 1] = g;
    imageData.data[pixelIndex + 2] = b;
    imageData.data[pixelIndex + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}
