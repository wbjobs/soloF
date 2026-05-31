export const baseVertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const advectionShader = `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTimeStep;
uniform float uDissipation;

varying vec2 vUv;

vec4 sampleSource(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 val = texture2D(uSource, uv);
  val.x = clamp(val.x, -10.0, 10.0);
  val.y = clamp(val.y, -10.0, 10.0);
  val.z = clamp(val.z, 0.0, 1.0);
  return val;
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  vec2 vel = sampleSource(vUv).xy;
  
  vel.x = clamp(vel.x, -5.0, 5.0);
  vel.y = clamp(vel.y, -5.0, 5.0);
  vel.x = isinf(vel.x) || isnan(vel.x) ? 0.0 : vel.x;
  vel.y = isinf(vel.y) || isnan(vel.y) ? 0.0 : vel.y;
  
  vec2 pos = vUv - vel * uTimeStep * texelSize;
  pos = clamp(pos, 0.0, 1.0);
  
  vec4 result = uDissipation * sampleSource(pos);
  result.x = clamp(result.x, -10.0, 10.0);
  result.y = clamp(result.y, -10.0, 10.0);
  result.z = clamp(result.z, 0.0, 1.0);
  
  gl_FragColor = result;
}
`;

export const diffusionShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uDiffusion;

varying vec2 vUv;

vec4 sampleTexture(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 val = texture2D(uTexture, uv);
  val.x = clamp(val.x, 0.0, 1.0);
  val.y = clamp(val.y, -10.0, 10.0);
  val.z = clamp(val.z, -10.0, 10.0);
  return val;
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  
  bool isLeft = vUv.x < texelSize.x;
  bool isRight = vUv.x > 1.0 - texelSize.x;
  bool isBottom = vUv.y < texelSize.y;
  bool isTop = vUv.y > 1.0 - texelSize.y;
  
  vec4 center = sampleTexture(vUv);
  vec4 left, right, bottom, top;
  
  if (isLeft) {
    left = sampleTexture(vUv);
  } else {
    left = sampleTexture(vUv - vec2(texelSize.x, 0.0));
  }
  
  if (isRight) {
    right = sampleTexture(vUv);
  } else {
    right = sampleTexture(vUv + vec2(texelSize.x, 0.0));
  }
  
  if (isBottom) {
    bottom = sampleTexture(vUv);
  } else {
    bottom = sampleTexture(vUv - vec2(0.0, texelSize.y));
  }
  
  if (isTop) {
    top = sampleTexture(vUv);
  } else {
    top = sampleTexture(vUv + vec2(0.0, texelSize.y));
  }
  
  float alpha = uDiffusion;
  vec4 result = (center + alpha * (left + right + bottom + top)) / (1.0 + 4.0 * alpha);
  
  result.x = clamp(result.x, 0.0, 1.0);
  result.y = clamp(result.y, -10.0, 10.0);
  result.z = clamp(result.z, -10.0, 10.0);
  
  gl_FragColor = result;
}
`;

export const pressureShader = `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uResolution;

varying vec2 vUv;

vec4 samplePressure(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  return texture2D(uPressure, uv);
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  
  bool isLeft = vUv.x < texelSize.x;
  bool isRight = vUv.x > 1.0 - texelSize.x;
  bool isBottom = vUv.y < texelSize.y;
  bool isTop = vUv.y > 1.0 - texelSize.y;
  
  float L, R, B, T;
  
  if (isLeft) {
    L = samplePressure(vUv).x;
  } else {
    L = samplePressure(vUv - vec2(texelSize.x, 0.0)).x;
  }
  
  if (isRight) {
    R = samplePressure(vUv).x;
  } else {
    R = samplePressure(vUv + vec2(texelSize.x, 0.0)).x;
  }
  
  if (isBottom) {
    B = samplePressure(vUv).x;
  } else {
    B = samplePressure(vUv - vec2(0.0, texelSize.y)).x;
  }
  
  if (isTop) {
    T = samplePressure(vUv).x;
  } else {
    T = samplePressure(vUv + vec2(0.0, texelSize.y)).x;
  }
  
  float div = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - div) * 0.25;
  
  pressure = clamp(pressure, -10.0, 10.0);
  pressure = isinf(pressure) || isnan(pressure) ? 0.0 : pressure;
  
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

export const divergenceShader = `
uniform sampler2D uVelocity;
uniform vec2 uResolution;

varying vec2 vUv;

vec4 sampleVelocity(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 vel = texture2D(uVelocity, uv);
  vel.x = clamp(vel.x, -10.0, 10.0);
  vel.y = clamp(vel.y, -10.0, 10.0);
  return vel;
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  
  bool isLeft = vUv.x < texelSize.x;
  bool isRight = vUv.x > 1.0 - texelSize.x;
  bool isBottom = vUv.y < texelSize.y;
  bool isTop = vUv.y > 1.0 - texelSize.y;
  
  float L, R, B, T;
  
  if (isLeft) {
    L = 0.0;
  } else {
    L = sampleVelocity(vUv - vec2(texelSize.x, 0.0)).x;
  }
  
  if (isRight) {
    R = 0.0;
  } else {
    R = sampleVelocity(vUv + vec2(texelSize.x, 0.0)).x;
  }
  
  if (isBottom) {
    B = 0.0;
  } else {
    B = sampleVelocity(vUv - vec2(0.0, texelSize.y)).y;
  }
  
  if (isTop) {
    T = 0.0;
  } else {
    T = sampleVelocity(vUv + vec2(0.0, texelSize.y)).y;
  }
  
  float div = 0.5 * ((R - L) + (T - B));
  div = clamp(div, -5.0, 5.0);
  div = isinf(div) || isnan(div) ? 0.0 : div;
  
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const gradientSubtractShader = `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uResolution;

varying vec2 vUv;

vec4 samplePressure(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 p = texture2D(uPressure, uv);
  p.x = clamp(p.x, -10.0, 10.0);
  return p;
}

vec4 sampleVelocity(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 vel = texture2D(uVelocity, uv);
  vel.x = clamp(vel.x, -10.0, 10.0);
  vel.y = clamp(vel.y, -10.0, 10.0);
  return vel;
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  
  bool isLeft = vUv.x < texelSize.x;
  bool isRight = vUv.x > 1.0 - texelSize.x;
  bool isBottom = vUv.y < texelSize.y;
  bool isTop = vUv.y > 1.0 - texelSize.y;
  
  float L, R, B, T;
  
  if (isLeft) {
    L = samplePressure(vUv).x;
  } else {
    L = samplePressure(vUv - vec2(texelSize.x, 0.0)).x;
  }
  
  if (isRight) {
    R = samplePressure(vUv).x;
  } else {
    R = samplePressure(vUv + vec2(texelSize.x, 0.0)).x;
  }
  
  if (isBottom) {
    B = samplePressure(vUv).x;
  } else {
    B = samplePressure(vUv - vec2(0.0, texelSize.y)).x;
  }
  
  if (isTop) {
    T = samplePressure(vUv).x;
  } else {
    T = samplePressure(vUv + vec2(0.0, texelSize.y)).x;
  }
  
  vec2 vel = sampleVelocity(vUv).xy;
  vel -= 0.5 * vec2(R - L, T - B);
  
  vel.x = clamp(vel.x, -10.0, 10.0);
  vel.y = clamp(vel.y, -10.0, 10.0);
  vel.x = isinf(vel.x) || isnan(vel.x) ? 0.0 : vel.x;
  vel.y = isinf(vel.y) || isnan(vel.y) ? 0.0 : vel.y;
  
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

export const viscosityShader = `
uniform sampler2D uVelocity;
uniform vec2 uResolution;
uniform float uViscosity;

varying vec2 vUv;

vec4 sampleVelocity(vec2 uv) {
  uv = clamp(uv, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
  vec4 vel = texture2D(uVelocity, uv);
  vel.x = clamp(vel.x, -10.0, 10.0);
  vel.y = clamp(vel.y, -10.0, 10.0);
  return vel;
}

void main() {
  vec2 texelSize = 1.0 / uResolution;
  
  bool isLeft = vUv.x < texelSize.x;
  bool isRight = vUv.x > 1.0 - texelSize.x;
  bool isBottom = vUv.y < texelSize.y;
  bool isTop = vUv.y > 1.0 - texelSize.y;
  
  vec4 center = sampleVelocity(vUv);
  vec4 left, right, bottom, top;
  
  if (isLeft) {
    left = sampleVelocity(vUv);
  } else {
    left = sampleVelocity(vUv - vec2(texelSize.x, 0.0));
  }
  
  if (isRight) {
    right = sampleVelocity(vUv);
  } else {
    right = sampleVelocity(vUv + vec2(texelSize.x, 0.0));
  }
  
  if (isBottom) {
    bottom = sampleVelocity(vUv);
  } else {
    bottom = sampleVelocity(vUv - vec2(0.0, texelSize.y));
  }
  
  if (isTop) {
    top = sampleVelocity(vUv);
  } else {
    top = sampleVelocity(vUv + vec2(0.0, texelSize.y));
  }
  
  float alpha = uViscosity;
  vec4 result = (center + alpha * (left + right + bottom + top)) / (1.0 + 4.0 * alpha);
  
  result.x = clamp(result.x, -10.0, 10.0);
  result.y = clamp(result.y, -10.0, 10.0);
  
  gl_FragColor = result;
}
`;

export const mouseForceShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform vec2 uMouseDelta;
uniform float uRadius;
uniform float uStrength;

varying vec2 vUv;

void main() {
  vec2 pos = vUv * uResolution;
  float dist = length(pos - uMouse);
  float influence = smoothstep(uRadius, 0.0, dist);
  
  vec4 original = texture2D(uTexture, vUv);
  vec2 force = uMouseDelta * uStrength * influence;
  
  gl_FragColor = vec4(original.xy + force, 0.0, 1.0);
}
`;

export const smokeDensityShader = `
uniform sampler2D uDensity;

varying vec2 vUv;

vec3 heatmap(float value) {
  value = clamp(value, 0.0, 1.0);
  if (value < 0.5) {
    float t = value * 2.0;
    return vec3(t, 0.0, 0.0);
  } else if (value < 0.75) {
    float t = (value - 0.5) * 4.0;
    return vec3(1.0, t, 0.0);
  } else {
    float t = (value - 0.75) * 4.0;
    return vec3(1.0, 1.0, t);
  }
}

void main() {
  float density = texture2D(uDensity, vUv).x;
  vec3 color = heatmap(density);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const smokeInjectShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uRadius;
uniform float uStrength;

varying vec2 vUv;

void main() {
  vec2 pos = vUv * uResolution;
  float dist = length(pos - uMouse);
  float influence = smoothstep(uRadius, 0.0, dist) * uStrength;
  
  float original = texture2D(uTexture, vUv).x;
  float newDensity = original + influence;
  
  gl_FragColor = vec4(clamp(newDensity, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

export const boundaryClearShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uBoundaryWidth;

varying vec2 vUv;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  float boundary = uBoundaryWidth * texelSize.x;
  
  bool isLeft = vUv.x < boundary;
  bool isRight = vUv.x > 1.0 - boundary;
  bool isBottom = vUv.y < boundary;
  bool isTop = vUv.y > 1.0 - boundary;
  
  if (isLeft || isRight || isBottom || isTop) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    vec4 val = texture2D(uTexture, vUv);
    val.x = clamp(val.x, 0.0, 1.0);
    val.y = clamp(val.y, 0.0, 1.0);
    val.z = clamp(val.z, 0.0, 1.0);
    val.w = clamp(val.w, 0.0, 1.0);
    gl_FragColor = val;
  }
}
`;

export const multiEmitterShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uPositions[5];
uniform vec3 uColors[5];
uniform float uStrengths[5];
uniform float uRadii[5];
uniform int uActiveCount;

varying vec2 vUv;

void main() {
  vec2 pos = vUv * uResolution;
  vec4 original = texture2D(uTexture, vUv);
  
  float totalDensity = original.w;
  vec3 totalColor = original.rgb * original.w;
  
  for (int i = 0; i < 5; i++) {
    if (i >= uActiveCount) break;
    
    float dist = length(pos - uPositions[i]);
    float influence = smoothstep(uRadii[i], 0.0, dist) * uStrengths[i];
    
    totalDensity = totalDensity + influence - totalDensity * influence;
    totalColor = mix(totalColor, uColors[i], influence);
  }
  
  totalDensity = clamp(totalDensity, 0.0, 1.0);
  totalColor = clamp(totalColor, 0.0, 1.0);
  
  gl_FragColor = vec4(totalColor, totalDensity);
}
`;

export const coloredSmokeShader = `
uniform sampler2D uDensity;

varying vec2 vUv;

void main() {
  vec4 val = texture2D(uDensity, vUv);
  float density = clamp(val.w, 0.0, 1.0);
  vec3 color = clamp(val.rgb, 0.0, 1.0);
  
  float brightness = density * 0.7 + 0.3;
  color = color * brightness;
  
  vec3 background = vec3(0.02, 0.02, 0.05);
  color = mix(background, color, density);
  
  gl_FragColor = vec4(color, 1.0);
}
`;

export const emitterVelocityShader = `
uniform sampler2D uVelocity;
uniform vec2 uResolution;
uniform vec2 uPositions[5];
uniform vec2 uVelocities[5];
uniform float uStrengths[5];
uniform float uRadii[5];
uniform int uActiveCount;

varying vec2 vUv;

void main() {
  vec2 pos = vUv * uResolution;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  
  for (int i = 0; i < 5; i++) {
    if (i >= uActiveCount) break;
    
    float dist = length(pos - uPositions[i]);
    float influence = smoothstep(uRadii[i], 0.0, dist) * uStrengths[i];
    
    vel += uVelocities[i] * influence;
  }
  
  vel.x = clamp(vel.x, -10.0, 10.0);
  vel.y = clamp(vel.y, -10.0, 10.0);
  vel.x = isinf(vel.x) || isnan(vel.x) ? 0.0 : vel.x;
  vel.y = isinf(vel.y) || isnan(vel.y) ? 0.0 : vel.y;
  
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;
