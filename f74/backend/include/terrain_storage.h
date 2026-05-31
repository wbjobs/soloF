#pragma once

#include <string>
#include <memory>
#include <mutex>
#include <vector>
#include <leveldb/db.h>
#include "terrain.pb.h"

namespace terrain {

class TerrainStorage {
public:
    explicit TerrainStorage(const std::string& dbPath = "./terrain_db");
    ~TerrainStorage();
    
    bool init();
    
    bool saveModifications(int chunkX, int chunkY, int chunkZ,
                          const google::protobuf::RepeatedPtrField<VoxelModification>& mods,
                          int64_t timestamp);
    
    bool getModifications(int chunkX, int chunkY, int chunkZ,
                         google::protobuf::RepeatedPtrField<VoxelModification>* mods,
                         int64_t* lastModified);
    
    bool hasModifications(int chunkX, int chunkY, int chunkZ);
    
    bool applyModifications(int chunkX, int chunkY, int chunkZ,
                           ChunkData* chunkData);
    
    void close();

private:
    std::string dbPath_;
    std::unique_ptr<leveldb::DB> db_;
    std::mutex mutex_;
    
    static std::string getChunkKey(int chunkX, int chunkY, int chunkZ);
    
    bool serializeModifications(const google::protobuf::RepeatedPtrField<VoxelModification>& mods,
                               int64_t timestamp,
                               std::string* output);
    
    bool deserializeModifications(const std::string& data,
                                 google::protobuf::RepeatedPtrField<VoxelModification>* mods,
                                 int64_t* timestamp);
};

} // namespace terrain
