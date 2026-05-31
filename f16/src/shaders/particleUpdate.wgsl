struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> particlesIn: array<Particle, 50000>;
@group(0) @binding(1) var<storage, write> particlesOut: array<Particle, 50000>;
@group(0) @binding(2) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;
let timeStep: f32 = uniforms.z;
let particleCount: u32 = 50000u;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  
  if (idx >= particleCount) {
    return;
  }

  let particle = particlesIn[idx];
  var pos = particle.pos;
  var vel = particle.vel;

  let texPos = pos * gridSize;
  let clampedPos = clamp(texPos, vec2<f32>(0.5), vec2<f32>(gridSize - 1.5));
  
  let texel = vec2<i32>(floor(clampedPos));
  
  let v00 = textureLoad(velocity, texel).xy;
  let v10 = textureLoad(velocity, texel + vec2<i32>(1, 0)).xy;
  let v01 = textureLoad(velocity, texel + vec2<i32>(0, 1)).xy;
  let v11 = textureLoad(velocity, texel + vec2<i32>(1, 1)).xy;

  let frac = fract(clampedPos);
  let v0 = mix(v00, v10, frac.x);
  let v1 = mix(v01, v11, frac.x);
  let fieldVel = mix(v0, v1, frac.y);

  vel = mix(vel, fieldVel, 0.4);
  pos += vel * timeStep;

  if (pos.x < 0.0) { pos.x = pos.x + 1.0; }
  if (pos.x > 1.0) { pos.x = pos.x - 1.0; }
  if (pos.y < 0.0) { pos.y = pos.y + 1.0; }
  if (pos.y > 1.0) { pos.y = pos.y - 1.0; }

  particlesOut[idx] = Particle(pos, vel);
}
