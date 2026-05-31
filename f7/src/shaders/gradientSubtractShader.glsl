uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
  
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel -= 0.5 * vec2(R - L, T - B);
  
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
