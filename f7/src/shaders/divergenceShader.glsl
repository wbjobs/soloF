uniform sampler2D uVelocity;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).y;
  
  float div = 0.5 * ((R - L) + (T - B));
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
