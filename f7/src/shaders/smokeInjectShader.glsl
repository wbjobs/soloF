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
