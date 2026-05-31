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
