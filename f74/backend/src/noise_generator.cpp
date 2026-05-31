#include "noise_generator.h"
#include <random>
#include <algorithm>

namespace terrain {

const std::array<std::array<float, 3>, 12> SimplexNoise::grad3_ = {{
    {{1, 1, 0}}, {{-1, 1, 0}}, {{1, -1, 0}}, {{-1, -1, 0}},
    {{1, 0, 1}}, {{-1, 0, 1}}, {{1, 0, -1}}, {{-1, 0, -1}},
    {{0, 1, 1}}, {{0, -1, 1}}, {{0, 1, -1}}, {{0, -1, -1}}
}};

SimplexNoise::SimplexNoise(int seed) {
    std::mt19937 rng(seed);
    for (int i = 0; i < 256; ++i) {
        perm_[i] = i;
    }
    std::shuffle(perm_.begin(), perm_.begin() + 256, rng);
    for (int i = 0; i < 256; ++i) {
        perm_[i + 256] = perm_[i];
    }
}

float SimplexNoise::fade(float t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

float SimplexNoise::lerp(float a, float b, float t) {
    return a + t * (b - a);
}

float SimplexNoise::dot(const std::array<float, 3>& g, float x, float y, float z) {
    return g[0] * x + g[1] * y + g[2] * z;
}

float SimplexNoise::sample(float x, float y, float z) const {
    const float F3 = 1.0f / 3.0f;
    const float G3 = 1.0f / 6.0f;
    
    float s = (x + y + z) * F3;
    int i = static_cast<int>(std::floor(x + s));
    int j = static_cast<int>(std::floor(y + s));
    int k = static_cast<int>(std::floor(z + s));
    
    float t = (i + j + k) * G3;
    float X0 = i - t;
    float Y0 = j - t;
    float Z0 = k - t;
    float x0 = x - X0;
    float y0 = y - Y0;
    float z0 = z - Z0;
    
    int i1, j1, k1;
    int i2, j2, k2;
    
    if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    
    float x1 = x0 - i1 + G3;
    float y1 = y0 - j1 + G3;
    float z1 = z0 - k1 + G3;
    float x2 = x0 - i2 + 2.0f * G3;
    float y2 = y0 - j2 + 2.0f * G3;
    float z2 = z0 - k2 + 2.0f * G3;
    float x3 = x0 - 1.0f + 3.0f * G3;
    float y3 = y0 - 1.0f + 3.0f * G3;
    float z3 = z0 - 1.0f + 3.0f * G3;
    
    int ii = i & 255;
    int jj = j & 255;
    int kk = k & 255;
    
    int gi0 = perm_[ii + perm_[jj + perm_[kk]]] % 12;
    int gi1 = perm_[ii + i1 + perm_[jj + j1 + perm_[kk + k1]]] % 12;
    int gi2 = perm_[ii + i2 + perm_[jj + j2 + perm_[kk + k2]]] % 12;
    int gi3 = perm_[ii + 1 + perm_[jj + 1 + perm_[kk + 1]]] % 12;
    
    float n0, n1, n2, n3;
    
    float t0 = 0.6f - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0f;
    else {
        t0 *= t0;
        n0 = t0 * t0 * dot(grad3_[gi0], x0, y0, z0);
    }
    
    float t1 = 0.6f - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0f;
    else {
        t1 *= t1;
        n1 = t1 * t1 * dot(grad3_[gi1], x1, y1, z1);
    }
    
    float t2 = 0.6f - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0f;
    else {
        t2 *= t2;
        n2 = t2 * t2 * dot(grad3_[gi2], x2, y2, z2);
    }
    
    float t3 = 0.6f - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0f;
    else {
        t3 *= t3;
        n3 = t3 * t3 * dot(grad3_[gi3], x3, y3, z3);
    }
    
    return 32.0f * (n0 + n1 + n2 + n3);
}

float SimplexNoise::fbm(float x, float y, float z,
                        int octaves, float persistence, float lacunarity,
                        float frequency, float amplitude) const {
    float total = 0.0f;
    float maxValue = 0.0f;
    
    for (int i = 0; i < octaves; ++i) {
        total += sample(x * frequency, y * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return total / maxValue;
}

std::vector<float> SimplexNoise::generateDensityField(
    int chunkX, int chunkY, int chunkZ,
    int size, float scale,
    int octaves, float persistence, float lacunarity,
    float frequency, float amplitude) const {
    
    std::vector<float> field;
    field.reserve(size * size * size);
    
    for (int z = 0; z < size; ++z) {
        for (int y = 0; y < size; ++y) {
            for (int x = 0; x < size; ++x) {
                float worldX = (chunkX * size + x) * scale;
                float worldY = (chunkY * size + y) * scale;
                float worldZ = (chunkZ * size + z) * scale;
                
                float noiseVal = fbm(worldX, worldY, worldZ, octaves, persistence, lacunarity, frequency, amplitude);
                
                float heightFactor = static_cast<float>(y) / static_cast<float>(size);
                float density = noiseVal + (0.5f - heightFactor) * 2.0f;
                
                field.push_back(density);
            }
        }
    }
    
    return field;
}

template <typename RepeatedField>
void SimplexNoise::generateDensityField(
    int chunkX, int chunkY, int chunkZ,
    int size, float scale,
    int octaves, float persistence, float lacunarity,
    float frequency, float amplitude,
    RepeatedField* output) const {
    
    for (int z = 0; z < size; ++z) {
        for (int y = 0; y < size; ++y) {
            for (int x = 0; x < size; ++x) {
                float worldX = (chunkX * size + x) * scale;
                float worldY = (chunkY * size + y) * scale;
                float worldZ = (chunkZ * size + z) * scale;
                
                float noiseVal = fbm(worldX, worldY, worldZ, octaves, persistence, lacunarity, frequency, amplitude);
                
                float heightFactor = static_cast<float>(y) / static_cast<float>(size);
                float density = noiseVal + (0.5f - heightFactor) * 2.0f;
                
                output->Add(density);
            }
        }
    }
}

template void SimplexNoise::generateDensityField<google::protobuf::RepeatedField<float>>(
    int, int, int, int, float, int, float, float, float, float,
    google::protobuf::RepeatedField<float>*) const;

} // namespace terrain
