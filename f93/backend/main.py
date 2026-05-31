import hashlib
import json
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple, Optional

app = FastAPI(title="Path Tracing Heatmap API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = {}


class Material(BaseModel):
    reflectivity: float
    roughness: float
    color: List[float]


class Sphere(BaseModel):
    type: str
    position: List[float]
    radius: float
    material: Material


class Plane(BaseModel):
    type: str
    position: List[float]
    normal: List[float]
    material: Material


class PointLight(BaseModel):
    position: List[float]
    intensity: float
    color: List[float]


class CameraParams(BaseModel):
    position: List[float]
    target: List[float]
    fov: float


class SceneDescription(BaseModel):
    geometries: List[dict]
    lights: List[PointLight]
    resolution: dict
    samplesPerPixel: int
    camera: Optional[CameraParams] = None


class BounceHeatmap(BaseModel):
    bounce: int
    data: List[float]
    maxBrightness: float


class HeatmapResponse(BaseModel):
    width: int
    height: int
    bounces: List[BounceHeatmap]
    cached: bool


def normalize(v: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(v)
    return v / norm if norm > 0 else v


def random_in_unit_sphere(rng: np.random.Generator) -> np.ndarray:
    while True:
        p = rng.uniform(-1, 1, 3)
        if np.dot(p, p) < 1:
            return p


def random_on_hemisphere(normal: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    on_sphere = normalize(random_in_unit_sphere(rng))
    if np.dot(on_sphere, normal) > 0:
        return on_sphere
    return -on_sphere


def intersect_sphere(origin: np.ndarray, direction: np.ndarray, 
                    center: np.ndarray, radius: float) -> Tuple[bool, float, np.ndarray]:
    oc = origin - center
    a = np.dot(direction, direction)
    half_b = np.dot(oc, direction)
    c = np.dot(oc, oc) - radius * radius
    discriminant = half_b * half_b - a * c
    
    if discriminant < 0:
        return False, 0.0, np.zeros(3)
    
    sqrt_d = np.sqrt(discriminant)
    t = (-half_b - sqrt_d) / a
    
    if t < 0.001:
        t = (-half_b + sqrt_d) / a
        if t < 0.001:
            return False, 0.0, np.zeros(3)
    
    hit_point = origin + t * direction
    normal = normalize(hit_point - center)
    return True, t, normal


def intersect_plane(origin: np.ndarray, direction: np.ndarray,
                   point: np.ndarray, normal: np.ndarray) -> Tuple[bool, float]:
    denom = np.dot(direction, normal)
    if abs(denom) < 1e-6:
        return False, 0.0
    
    t = np.dot(point - origin, normal) / denom
    if t < 0.001:
        return False, 0.0
    
    return True, t


def trace_ray(origin: np.ndarray, direction: np.ndarray, geometries: list,
              lights: List[PointLight], rng: np.random.Generator, 
              max_depth: int = 3, current_bounce: int = 0) -> np.ndarray:
    bounce_contributions = np.zeros(3, dtype=np.float32)
    
    if max_depth <= 0 or current_bounce >= 3:
        return bounce_contributions
    
    closest_t = float('inf')
    closest_obj = None
    closest_normal = None
    
    for geom in geometries:
        if geom['type'] == 'sphere':
            center = np.array(geom['position'])
            radius = geom['radius']
            hit, t, normal = intersect_sphere(origin, direction, center, radius)
            if hit and t < closest_t:
                closest_t = t
                closest_obj = geom
                closest_normal = normal
        elif geom['type'] == 'plane':
            point = np.array(geom['position'])
            normal = np.array(geom['normal'])
            hit, t = intersect_plane(origin, direction, point, normal)
            if hit and t < closest_t:
                closest_t = t
                closest_obj = geom
                closest_normal = normal
    
    if closest_obj is None:
        return bounce_contributions
    
    hit_point = origin + direction * closest_t
    material = closest_obj['material']
    reflectivity = material['reflectivity']
    roughness = material['roughness']
    
    direct_brightness = 0.0
    
    for light in lights:
        light_pos = np.array(light['position'])
        light_intensity = light['intensity']
        
        to_light = light_pos - hit_point
        light_dist = np.linalg.norm(to_light)
        light_dir = to_light / light_dist
        
        shadow_origin = hit_point + closest_normal * 0.01
        in_shadow = False
        
        for geom in geometries:
            if geom['type'] == 'sphere':
                center = np.array(geom['position'])
                radius = geom['radius']
                hit, t, _ = intersect_sphere(shadow_origin, light_dir, center, radius)
                if hit and t < light_dist:
                    in_shadow = True
                    break
            elif geom['type'] == 'plane':
                point = np.array(geom['position'])
                normal = np.array(geom['normal'])
                hit, t = intersect_plane(shadow_origin, light_dir, point, normal)
                if hit and t < light_dist:
                    in_shadow = True
                    break
        
        if not in_shadow:
            ndotl = max(0, np.dot(closest_normal, light_dir))
            attenuation = 1.0 / (light_dist * light_dist)
            direct_brightness += ndotl * light_intensity * attenuation * (1 - reflectivity * 0.5)
    
    bounce_contributions[current_bounce] += direct_brightness
    
    if max_depth > 1 and current_bounce < 2:
        if reflectivity > 0.01:
            if roughness > 0.5:
                reflect_dir = normalize(closest_normal + random_in_unit_sphere(rng))
            else:
                ideal_reflect = direction - 2 * np.dot(direction, closest_normal) * closest_normal
                reflect_dir = normalize(ideal_reflect + roughness * random_in_unit_sphere(rng))
            
            reflect_origin = hit_point + closest_normal * 0.01
            reflected = trace_ray(reflect_origin, reflect_dir, geometries, lights, rng, max_depth - 1, current_bounce + 1)
            bounce_contributions += reflected * reflectivity * 0.7
        
        if direct_brightness < 0.05:
            scatter_dir = random_on_hemisphere(closest_normal, rng)
            scatter_origin = hit_point + closest_normal * 0.01
            indirect = trace_ray(scatter_origin, scatter_dir, geometries, lights, rng, max_depth - 1, current_bounce + 1)
            bounce_contributions += indirect * 0.3
    
    return bounce_contributions


def calculate_heatmap(scene: SceneDescription) -> Tuple[List[np.ndarray], List[float]]:
    width = scene.resolution['width']
    height = scene.resolution['height']
    samples = scene.samplesPerPixel
    
    heatmaps = [np.zeros((height, width), dtype=np.float32) for _ in range(3)]
    rng = np.random.default_rng(42)
    
    if scene.camera is not None:
        cam_pos = np.array(scene.camera.position)
        cam_target = np.array(scene.camera.target)
        fov = scene.camera.fov
    else:
        cam_pos = np.array([0, 2, 5])
        cam_target = np.array([0, 0, 0])
        fov = np.pi / 4
    
    aspect = width / height
    
    forward = normalize(cam_target - cam_pos)
    world_up = np.array([0, 1, 0])
    right = normalize(np.cross(forward, world_up))
    up = normalize(np.cross(right, forward))
    
    for y in range(height):
        for x in range(width):
            total_contributions = np.zeros(3, dtype=np.float32)
            
            for _ in range(samples):
                u = (x + rng.random()) / width
                v = (y + rng.random()) / height
                
                px = (2 * u - 1) * aspect * np.tan(fov / 2)
                py = (1 - 2 * v) * np.tan(fov / 2)
                
                direction = normalize(forward + px * right + py * up)
                
                contributions = trace_ray(cam_pos, direction, scene.geometries, scene.lights, rng)
                total_contributions += contributions
            
            for b in range(3):
                heatmaps[b][y, x] = total_contributions[b] / samples
    
    max_brightness_list = []
    for b in range(3):
        max_b = heatmaps[b].max()
        max_brightness_list.append(float(max_b))
        if max_b > 0:
            heatmaps[b] = heatmaps[b] / max_b
    
    return heatmaps, max_brightness_list


def get_scene_hash(scene: SceneDescription) -> str:
    scene_dict = scene.model_dump()
    scene_str = json.dumps(scene_dict, sort_keys=True)
    return hashlib.md5(scene_str.encode()).hexdigest()


@app.post("/api/path-trace", response_model=HeatmapResponse)
async def compute_path_trace(scene: SceneDescription):
    try:
        width = int(scene.resolution.get('width', 256))
        height = int(scene.resolution.get('height', 256))
        width = max(64, min(width, 1024))
        height = max(64, min(height, 1024))
        
        scene.resolution['width'] = width
        scene.resolution['height'] = height
        
        scene_hash = get_scene_hash(scene)
        
        if scene_hash in cache:
            cached_data = cache[scene_hash]
            return HeatmapResponse(
                width=cached_data['width'],
                height=cached_data['height'],
                bounces=cached_data['bounces'],
                cached=True
            )
        
        heatmaps, max_brightness_list = calculate_heatmap(scene)
        
        bounces = []
        expected_len = width * height
        
        for b in range(3):
            data = heatmaps[b].flatten().tolist()
            if len(data) != expected_len:
                raise ValueError(f"Bounce {b} data length mismatch: expected {expected_len}, got {len(data)}")
            bounces.append({
                'bounce': b,
                'data': data,
                'maxBrightness': max_brightness_list[b]
            })
        
        result = {
            'width': width,
            'height': height,
            'bounces': bounces
        }
        
        cache[scene_hash] = result
        
        if len(cache) > 20:
            oldest_key = next(iter(cache))
            del cache[oldest_key]
        
        return HeatmapResponse(
            width=result['width'],
            height=result['height'],
            bounces=result['bounces'],
            cached=False
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cache/size")
async def get_cache_size():
    return {"size": len(cache)}


@app.delete("/api/cache")
async def clear_cache():
    cache.clear()
    return {"message": "Cache cleared"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
