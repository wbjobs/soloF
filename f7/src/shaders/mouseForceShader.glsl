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
