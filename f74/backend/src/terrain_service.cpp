#include "terrain_service.h"
#include <cmath>
#include <chrono>
#include <thread>
#include <iostream>

namespace terrain {

TerrainServiceImpl::TerrainServiceImpl(int seed, const std::string& dbPath) 
    : noise_(seed), seed_(seed) {
    storage_ = std::make_unique<TerrainStorage>(dbPath);
    if (!storage_->init()) {
        std::cerr << "Warning: Failed to initialize terrain storage" << std::endl;
    }
}

grpc::Status TerrainServiceImpl::GetChunk(grpc::ServerContext* context,
                                          const ChunkRequest* request,
                                          ChunkData* response) {
    int chunkX = request->chunk_x();
    int chunkY = request->chunk_y();
    int chunkZ = request->chunk_z();
    int size = request->chunk_size();
    int lodLevel = request->lod_level();
    
    ChunkData data = generateChunkData(chunkX, chunkY, chunkZ, size, lodLevel);
    
    if (storage_) {
        storage_->applyModifications(chunkX, chunkY, chunkZ, &data);
    }
    
    response->Swap(&data);
    
    return grpc::Status::OK;
}

grpc::Status TerrainServiceImpl::EditChunk(grpc::ServerContext* context,
                                           const EditChunkRequest* request,
                                           EditResponse* response) {
    int chunkX = request->chunk_x();
    int chunkY = request->chunk_y();
    int chunkZ = request->chunk_z();
    
    if (!storage_) {
        response->set_success(false);
        response->set_message("Storage not initialized");
        response->set_modified_count(0);
        return grpc::Status(grpc::INTERNAL, "Storage not initialized");
    }
    
    int64_t timestamp = request->timestamp();
    if (timestamp == 0) {
        timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
    }
    
    bool success = storage_->saveModifications(
        chunkX, chunkY, chunkZ,
        request->modifications(),
        timestamp
    );
    
    response->set_success(success);
    response->set_message(success ? "OK" : "Failed to save modifications");
    response->set_modified_count(success ? request->modifications_size() : 0);
    
    if (success) {
        std::cout << "Saved " << request->modifications_size() 
                  << " modifications for chunk (" 
                  << chunkX << ", " << chunkY << ", " << chunkZ << ")" << std::endl;
    }
    
    return grpc::Status::OK;
}

grpc::Status TerrainServiceImpl::BatchEdit(grpc::ServerContext* context,
                                           const BatchEditRequest* request,
                                           EditResponse* response) {
    if (!storage_) {
        response->set_success(false);
        response->set_message("Storage not initialized");
        response->set_modified_count(0);
        return grpc::Status(grpc::INTERNAL, "Storage not initialized");
    }
    
    int totalModified = 0;
    bool allSuccess = true;
    std::string lastError;
    
    int64_t timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    for (const auto& edit : request->edits()) {
        if (context->IsCancelled()) {
            break;
        }
        
        bool success = storage_->saveModifications(
            edit.chunk_x(), edit.chunk_y(), edit.chunk_z(),
            edit.modifications(),
            timestamp
        );
        
        if (success) {
            totalModified += edit.modifications_size();
        } else {
            allSuccess = false;
            lastError = "Failed to save modifications for chunk " + 
                        std::to_string(edit.chunk_x()) + "," + 
                        std::to_string(edit.chunk_y()) + "," + 
                        std::to_string(edit.chunk_z());
        }
    }
    
    response->set_success(allSuccess);
    response->set_message(allSuccess ? "OK" : lastError);
    response->set_modified_count(totalModified);
    
    if (totalModified > 0) {
        std::cout << "Batch edit: saved " << totalModified 
                  << " modifications in " << request->edits_size() 
                  << " chunks" << std::endl;
    }
    
    return grpc::Status::OK;
}

grpc::Status TerrainServiceImpl::GetChunkModifications(grpc::ServerContext* context,
                                                       const GetModificationsRequest* request,
                                                       ModificationsResponse* response) {
    int chunkX = request->chunk_x();
    int chunkY = request->chunk_y();
    int chunkZ = request->chunk_z();
    
    if (!storage_) {
        response->set_has_modifications(false);
        response->set_last_modified(0);
        return grpc::Status::OK;
    }
    
    google::protobuf::RepeatedPtrField<VoxelModification> mods;
    int64_t lastModified = 0;
    
    bool hasMods = storage_->getModifications(chunkX, chunkY, chunkZ, &mods, &lastModified);
    
    response->set_has_modifications(hasMods);
    response->set_last_modified(lastModified);
    
    if (hasMods) {
        response->mutable_modifications()->Swap(&mods);
    }
    
    return grpc::Status::OK;
}

grpc::Status TerrainServiceImpl::StreamChunks(grpc::ServerContext* context,
                                              const CameraRequest* request,
                                              grpc::ServerWriter<ChunkData>* writer) {
    float camX = request->camera_x();
    float camY = request->camera_y();
    float camZ = request->camera_z();
    int viewDistance = request->view_distance();
    int chunkSize = request->chunk_size();
    
    int camChunkX = static_cast<int>(std::floor(camX / chunkSize));
    int camChunkY = static_cast<int>(std::floor(camY / chunkSize));
    int camChunkZ = static_cast<int>(std::floor(camZ / chunkSize));
    
    std::vector<std::tuple<int, int, int, float>> chunks;
    chunks.reserve((2 * viewDistance + 1) * (2 * viewDistance + 1) * 5);
    
    for (int x = -viewDistance; x <= viewDistance; ++x) {
        for (int z = -viewDistance; z <= viewDistance; ++z) {
            for (int y = -2; y <= 2; ++y) {
                if (context->IsCancelled()) {
                    return grpc::Status::CANCELLED;
                }
                
                int chunkX = camChunkX + x;
                int chunkY = camChunkY + y;
                int chunkZ = camChunkZ + z;
                
                float distance = std::sqrt(
                    static_cast<float>(x * x + y * y + z * z)
                );
                
                if (distance <= viewDistance) {
                    chunks.emplace_back(chunkX, chunkY, chunkZ, distance);
                }
            }
        }
    }
    
    std::sort(chunks.begin(), chunks.end(),
              [](const auto& a, const auto& b) {
                  return std::get<3>(a) < std::get<3>(b);
              });
    
    for (const auto& chunk : chunks) {
        if (context->IsCancelled()) {
            return grpc::Status::CANCELLED;
        }
        
        int chunkX = std::get<0>(chunk);
        int chunkY = std::get<1>(chunk);
        int chunkZ = std::get<2>(chunk);
        float distance = std::get<3>(chunk);
        
        int lodLevel = 0;
        if (distance > viewDistance * 0.75f) {
            lodLevel = 3;
        } else if (distance > viewDistance * 0.5f) {
            lodLevel = 2;
        } else if (distance > viewDistance * 0.25f) {
            lodLevel = 1;
        }
        
        ChunkData data = generateChunkData(chunkX, chunkY, chunkZ, chunkSize, lodLevel);
        
        if (storage_) {
            storage_->applyModifications(chunkX, chunkY, chunkZ, &data);
        }
        
        if (context->IsCancelled()) {
            return grpc::Status::CANCELLED;
        }
        
        if (!writer->Write(data)) {
            return grpc::Status::CANCELLED;
        }
        
        std::this_thread::sleep_for(std::chrono::microseconds(100));
    }
    
    return grpc::Status::OK;
}

ChunkData TerrainServiceImpl::generateChunkData(int chunkX, int chunkY, int chunkZ,
                                                int size, int lodLevel) const {
    ChunkData data;
    
    data.set_chunk_x(chunkX);
    data.set_chunk_y(chunkY);
    data.set_chunk_z(chunkZ);
    data.set_size(size);
    data.set_lod_level(lodLevel);
    data.set_iso_surface(getIsoSurface());
    
    auto* seed = data.mutable_noise_seed();
    seed->set_seed(seed_);
    seed->set_frequency(0.02f);
    seed->set_amplitude(1.0f);
    seed->set_octaves(6);
    seed->set_persistence(0.5f);
    seed->set_lacunarity(2.0f);
    
    float scale = 0.05f;
    int octaves = 6;
    float persistence = 0.5f;
    float lacunarity = 2.0f;
    float frequency = 1.0f;
    float amplitude = 1.0f;
    
    const int totalVoxels = size * size * size;
    data.mutable_density_field()->Reserve(totalVoxels);
    
    noise_.generateDensityField(
        chunkX, chunkY, chunkZ,
        size, scale,
        octaves, persistence, lacunarity,
        frequency, amplitude,
        data.mutable_density_field()
    );
    
    return data;
}

} // namespace terrain
