#pragma once

#include <grpcpp/grpcpp.h>
#include <memory>
#include "terrain.grpc.pb.h"
#include "noise_generator.h"
#include "terrain_storage.h"

namespace terrain {

class TerrainServiceImpl final : public TerrainService::Service {
public:
    explicit TerrainServiceImpl(int seed = 1337, const std::string& dbPath = "./terrain_db");
    
    grpc::Status GetChunk(grpc::ServerContext* context,
                          const ChunkRequest* request,
                          ChunkData* response) override;
    
    grpc::Status StreamChunks(grpc::ServerContext* context,
                              const CameraRequest* request,
                              grpc::ServerWriter<ChunkData>* writer) override;
    
    grpc::Status EditChunk(grpc::ServerContext* context,
                           const EditChunkRequest* request,
                           EditResponse* response) override;
    
    grpc::Status BatchEdit(grpc::ServerContext* context,
                           const BatchEditRequest* request,
                           EditResponse* response) override;
    
    grpc::Status GetChunkModifications(grpc::ServerContext* context,
                                       const GetModificationsRequest* request,
                                       ModificationsResponse* response) override;

private:
    SimplexNoise noise_;
    int seed_;
    std::unique_ptr<TerrainStorage> storage_;
    
    ChunkData generateChunkData(int chunkX, int chunkY, int chunkZ,
                                int size, int lodLevel) const;
    
    float getIsoSurface() const { return 0.0f; }
};

} // namespace terrain
