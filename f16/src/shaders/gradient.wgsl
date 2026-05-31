@group(0) @binding(0) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var pressure: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var velocityOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u32(gridSize) || id.y >= u32(gridSize)) {
    return;
  }

  let pos = vec2<i32>(id.xy);
  
  let vel = textureLoad(velocity, pos).xy;
  
  let L = textureLoad(pressure, pos + vec2<i32>(-1, 0)).x;
  let R = textureLoad(pressure, pos + vec2<i32>(1, 0)).x;
  let B = textureLoad(pressure, pos + vec2<i32>(0, -1)).x;
  let T = textureLoad(pressure, pos + vec2<i32>(0, 1)).x;

  let grad = 0.5 * vec2<f32>(R - L, T - B);
  let newVel = vel - grad;

  textureStore(velocityOut, pos, vec4<f32>(newVel, 0.0, 1.0));
}
