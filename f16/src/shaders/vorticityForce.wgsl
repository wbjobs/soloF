@group(0) @binding(0) var vorticity: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var velocityIn: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var velocityOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<uniform> uniforms: vec4<f32>;

let gridSize: f32 = uniforms.x;
let timeStep: f32 = uniforms.z;
let vorticityStrength: f32 = uniforms.w;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let pos = vec2<i32>(id.xy);
  
  if (f32(pos.x) >= gridSize || f32(pos.y) >= gridSize) {
    return;
  }

  let L = textureLoad(vorticity, pos + vec2<i32>(-1, 0)).x;
  let R = textureLoad(vorticity, pos + vec2<i32>(1, 0)).x;
  let B = textureLoad(vorticity, pos + vec2<i32>(0, -1)).x;
  let T = textureLoad(vorticity, pos + vec2<i32>(0, 1)).x;
  let C = textureLoad(vorticity, pos).x;

  let force = 0.5 * vec2<f32>(abs(T) - abs(B), abs(L) - abs(R));
  let forceMag = length(force);
  
  if (forceMag > 0.0001) {
    let normalizedForce = force / forceMag;
    let finalForce = normalizedForce * C * vorticityStrength;
    
    let vel = textureLoad(velocityIn, pos).xy;
    let newVel = vel + finalForce * timeStep;
    
    textureStore(velocityOut, pos, vec4<f32>(newVel, 0.0, 1.0));
  } else {
    let vel = textureLoad(velocityIn, pos).xy;
    textureStore(velocityOut, pos, vec4<f32>(vel, 0.0, 1.0));
  }
}
