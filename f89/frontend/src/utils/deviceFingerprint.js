export async function generateFingerprint() {
  const components = [];

  components.push(navigator.userAgent);
  components.push(navigator.language);
  components.push(navigator.platform);
  components.push(navigator.hardwareConcurrency);
  components.push(navigator.deviceMemory || 'unknown');
  
  const screenInfo = `${screen.width}x${screen.height}x${screen.colorDepth}`;
  components.push(screenInfo);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  components.push(timezone);

  const canvasFingerprint = getCanvasFingerprint();
  components.push(canvasFingerprint);

  const webglFingerprint = getWebGLFingerprint();
  components.push(webglFingerprint);

  const fonts = getAvailableFonts();
  components.push(fonts.join(','));

  const combined = components.join('|');
  
  const hash = await hashString(combined);
  
  return hash;
}

function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('Device Fingerprint', 10, 10);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Device Fingerprint', 20, 20);
    
    return canvas.toDataURL();
  } catch (e) {
    return 'canvas_unsupported';
  }
}

function getWebGLFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) return 'webgl_unsupported';
    
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'webgl_no_debug';
    
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    
    return `${vendor}|${renderer}`;
  } catch (e) {
    return 'webgl_unsupported';
  }
}

function getAvailableFonts() {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testFonts = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria',
    'Candara', 'Century', 'Comic Sans MS', 'Consolas', 'Courier',
    'Courier New', 'Georgia', 'Helvetica', 'Impact', 'Lucida',
    'Microsoft Sans Serif', 'Palatino', 'Segoe UI', 'Tahoma',
    'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana'
  ];
  
  const available = [];
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  
  for (const font of testFonts) {
    const isAvailable = detectFont(font, testString, testSize, baseFonts);
    if (isAvailable) {
      available.push(font);
    }
  }
  
  return available;
}

function detectFont(font, testString, testSize, baseFonts) {
  const body = document.body;
  const span = document.createElement('span');
  span.style.fontSize = testSize;
  span.textContent = testString;
  
  const widths = {};
  
  for (const baseFont of baseFonts) {
    span.style.fontFamily = baseFont;
    body.appendChild(span);
    widths[baseFont] = span.offsetWidth;
    body.removeChild(span);
  }
  
  span.style.fontFamily = `'${font}', ${baseFonts[0]}`;
  body.appendChild(span);
  const detectedWidth = span.offsetWidth;
  body.removeChild(span);
  
  return !baseFonts.some(baseFont => widths[baseFont] === detectedWidth);
}

async function hashString(string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(string);
  
  if (crypto.subtle && crypto.subtle.digest) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

export function getStoredFingerprint() {
  return localStorage.getItem('deviceFingerprint');
}

export function setStoredFingerprint(fingerprint) {
  localStorage.setItem('deviceFingerprint', fingerprint);
}

export async function getOrCreateFingerprint() {
  let fingerprint = getStoredFingerprint();
  
  if (!fingerprint) {
    fingerprint = await generateFingerprint();
    setStoredFingerprint(fingerprint);
  }
  
  return fingerprint;
}
