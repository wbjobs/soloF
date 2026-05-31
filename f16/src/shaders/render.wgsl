@group(0) @binding(0) var<uniform> materialParams: vec4<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) speed: f32,
};

@vertex
fn vs_main(@location(0) particle: vec4<f32>) -> VertexOutput {
    let pos = particle.xy;
    let vel = particle.zw;
    
    let ndcPos = vec2<f32>(
        pos.x * 2.0 - 1.0,
        pos.y * -2.0 + 1.0
    );

    let speed = length(vel) * 5.0;
    let materialType = materialParams.x;

    var color: vec3<f32>;
    
    if (materialType < 0.5) {
        color = smokeColor(speed);
    } else {
        color = inkColor(speed);
    }

    let alpha = mix(materialParams.y, materialParams.z, min(speed, 1.0));

    return VertexOutput(
        vec4<f32>(ndcPos, 0.0, 1.0),
        vec4<f32>(color, alpha),
        speed
    );
}

fn smokeColor(speed: f32) -> vec3<f32> {
    let baseColor = vec3<f32>(0.6, 0.65, 0.75);
    let brightColor = vec3<f32>(0.95, 0.98, 1.0);
    let glowColor = vec3<f32>(0.8, 0.9, 1.0);
    
    let t = clamp(speed * 0.5, 0.0, 1.0);
    
    if (t < 0.5) {
        return mix(baseColor, brightColor, t * 2.0);
    } else {
        return mix(brightColor, glowColor, (t - 0.5) * 2.0);
    }
}

fn inkColor(speed: f32) -> vec3<f32> {
    let baseColor = vec3<f32>(0.15, 0.1, 0.35);
    let midColor = vec3<f32>(0.4, 0.2, 0.7);
    let glowColor = vec3<f32>(0.7, 0.3, 1.0);
    
    let t = clamp(speed * 0.5, 0.0, 1.0);
    
    if (t < 0.5) {
        return mix(baseColor, midColor, t * 2.0);
    } else {
        return mix(midColor, glowColor, (t - 0.5) * 2.0);
    }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
