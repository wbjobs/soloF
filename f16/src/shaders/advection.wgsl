@group(0) @binding(0) var inputVelocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var outputVelocity: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> uniforms: vec4<f32>;
@group(0) @binding(3) var<uniform> mouseData: vec4<f32>;
@group(0) @binding(4) var<uniform> mouseData2: vec4<f32>;

let gridSize: f32 = uniforms.x;
let timeStep: f32 = uniforms.z;
let dissipation: f32 = uniforms.w;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let pos = vec2<f32>(f32(id.x), f32(id.y));
  
  if (id.x >= u32(gridSize) || id.y >= u32(gridSize)) {
    return;
  }

  var vel = textureLoad(inputVelocity, vec2<i32>(id.xy)).xy;
  
  let mousePos = mouseData.xy;
  let mouseForce = mouseData.zw;
  let forceRadius = mouseData2.x;
  let mouseEnabled = mouseData2.y;

  let dist = distance(pos, mousePos);
  if (dist < forceRadius && mouseEnabled > 0.5) {
    let falloff = 1.0 - dist / forceRadius;
    vel += mouseForce * falloff * falloff * 5.0;
  }

  let samplePos = pos - vel * timeStep;
  let clampedPos = clamp(samplePos, vec2<f32>(0.5), vec2<f32>(gridSize - 1.5));

  let texel = vec2<i32>(floor(clampedPos));
  let frac = fract(clampedPos);

  let v00 = textureLoad(inputVelocity, texel).xy;
  let v10 = textureLoad(inputVelocity, texel + vec2<i32>(1, 0)).xy;
  let v01 = textureLoad(inputVelocity, texel + vec2<i32>(0, 1)).xy;
  let v11 = textureLoad(inputVelocity, texel + vec2<i32>(1, 1)).xy;

  let v0 = mix(v00, v10, frac.x);
  let v1 = mix(v01, v11, frac.x);
  let finalVel = mix(v0, v1, frac.y) * dissipation;

  textureStore(outputVelocity, vec2<i32>(id.xy), vec4<f32>(finalVel, 0.0, 1.0));
}
