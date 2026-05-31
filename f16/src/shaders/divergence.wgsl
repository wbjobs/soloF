@group(0) @binding(0) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var divergence: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u32(gridSize) || id.y >= u32(gridSize)) {
    return;
  }

  let pos = vec2<i32>(id.xy);
  
  let L = textureLoad(velocity, pos + vec2<i32>(-1, 0)).x;
  let R = textureLoad(velocity, pos + vec2<i32>(1, 0)).x;
  let B = textureLoad(velocity, pos + vec2<i32>(0, -1)).y;
  let T = textureLoad(velocity, pos + vec2<i32>(0, 1)).y;

  let div = 0.5 * ((R - L) + (T - B));

  textureStore(divergence, pos, vec4<f32>(div, 0.0, 0.0, 1.0));
}
