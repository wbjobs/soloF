#pragma once

#include <vector>
#include <array>
#include <cmath>
#include <google/protobuf/repeated_field.h>

namespace terrain {

class SimplexNoise {
public:
    explicit SimplexNoise(int seed = 1337);
    
    // 3D 噪声采样
    float sample(float x, float y, float z) const;
    
    // 分形布朗运动 (FBM)
    float fbm(float x, float y, float z, 
              int octaves = 6, 
              float persistence = 0.5f, 
              float lacunarity = 2.0f,
              float frequency = 1.0f,
              float amplitude = 1.0f) const;
    
    // 生成密度场
    std::vector<float> generateDensityField(
        int chunkX, int chunkY, int chunkZ,
        int size, float scale,
        int octaves, float persistence, float lacunarity,
        float frequency, float amplitude) const;
    
    // 生成密度场并直接写入到 protobuf repeated 字段
    template <typename RepeatedField>
    void generateDensityField(
        int chunkX, int chunkY, int chunkZ,
        int size, float scale,
        int octaves, float persistence, float lacunarity,
        float frequency, float amplitude,
        RepeatedField* output) const;

private:
    std::array<int, 512> perm_;
    
    static float fade(float t);
    static float lerp(float a, float b, float t);
    static float dot(const std::array<float, 3>& g, float x, float y, float z);
    
    static const std::array<std::array<float, 3>, 12> grad3_;
};

} // namespace terrain
