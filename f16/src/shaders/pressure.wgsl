@group(0) @binding(0) var divergence: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var pressureIn: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var pressureOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u32(gridSize) || id.y >= u32(gridSize)) {
    return;
  }

  let pos = vec2<i32>(id.xy);
  
  let div = textureLoad(divergence, pos).x;
  
  let L = textureLoad(pressureIn, pos + vec2<i32>(-1, 0)).x;
  let R = textureLoad(pressureIn, pos + vec2<i32>(1, 0)).x;
  let B = textureLoad(pressureIn, pos + vec2<i32>(0, -1)).x;
  let T = textureLoad(pressureIn, pos + vec2<i32>(0, 1)).x;

  let p = (L + R + B + T - div) * 0.25;

  textureStore(pressureOut, pos, vec4<f32>(p, 0.0, 0.0, 1.0));
}
