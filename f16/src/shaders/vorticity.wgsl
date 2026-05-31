@group(0) @binding(0) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var vorticity: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let pos = vec2<i32>(id.xy);
  
  if (f32(pos.x) >= gridSize || f32(pos.y) >= gridSize) {
    return;
  }

  let L = textureLoad(velocity, pos + vec2<i32>(-1, 0)).y;
  let R = textureLoad(velocity, pos + vec2<i32>(1, 0)).y;
  let B = textureLoad(velocity, pos + vec2<i32>(0, -1)).x;
  let T = textureLoad(velocity, pos + vec2<i32>(0, 1)).x;

  let vorticityVal = 0.5 * ((R - L) - (T - B));

  textureStore(vorticity, pos, vec4<f32>(vorticityVal, 0.0, 0.0, 1.0));
}
