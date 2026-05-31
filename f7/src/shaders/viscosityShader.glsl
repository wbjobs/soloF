uniform sampler2D uVelocity;
uniform vec2 uResolution;
uniform float uViscosity;

varying vec2 vUv;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  vec4 center = texture2D(uVelocity, vUv);
  vec4 left = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0));
  vec4 right = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0));
  vec4 bottom = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y));
  vec4 top = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y));
  
  float alpha = uViscosity;
  gl_FragColor = (center + alpha * (left + right + bottom + top)) / (1.0 + 4.0 * alpha);
}
