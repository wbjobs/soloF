export interface FrequencyData {
  lows: number;
  mids: number;
  highs: number;
  average: number;
  bass: number;
  treble: number;
}

export const extractFrequencyBands = (
  frequencyData: Uint8Array,
  sampleRate: number
): FrequencyData => {
  const fftSize = frequencyData.length * 2;
  const nyquist = sampleRate / 2;
  const binWidth = nyquist / frequencyData.length;

  let bassSum = 0;
  let bassCount = 0;
  let lowsSum = 0;
  let lowsCount = 0;
  let midsSum = 0;
  let midsCount = 0;
  let highsSum = 0;
  let highsCount = 0;
  let trebleSum = 0;
  let trebleCount = 0;
  let totalSum = 0;

  for (let i = 0; i < frequencyData.length; i++) {
    const freq = i * binWidth;
    const value = frequencyData[i] / 255;
    totalSum += value;

    if (freq < 60) {
      bassSum += value;
      bassCount++;
    } else if (freq < 250) {
      lowsSum += value;
      lowsCount++;
    } else if (freq < 2000) {
      midsSum += value;
      midsCount++;
    } else if (freq < 6000) {
      highsSum += value;
      highsCount++;
    } else if (freq < 20000) {
      trebleSum += value;
      trebleCount++;
    }
  }

  return {
    bass: bassCount > 0 ? bassSum / bassCount : 0,
    lows: lowsCount > 0 ? lowsSum / lowsCount : 0,
    mids: midsCount > 0 ? midsSum / midsCount : 0,
    highs: highsCount > 0 ? highsSum / highsCount : 0,
    treble: trebleCount > 0 ? trebleSum / trebleCount : 0,
    average: totalSum / frequencyData.length,
  };
};

export const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b];
};

export const lerp = (start: number, end: number, t: number): number => {
  return start + (end - start) * t;
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};
