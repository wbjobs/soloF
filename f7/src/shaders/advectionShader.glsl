uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTimeStep;
uniform float uDissipation;

varying vec2 vUv;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 pos = vUv - vel * uTimeStep * texelSize;
  gl_FragColor = uDissipation * texture2D(uSource, pos);
}
