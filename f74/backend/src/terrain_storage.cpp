#include "terrain_storage.h"
#include <sstream>
#include <iostream>

namespace terrain {

TerrainStorage::TerrainStorage(const std::string& dbPath) : dbPath_(dbPath) {}

TerrainStorage::~TerrainStorage() {
    close();
}

bool TerrainStorage::init() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    leveldb::Options options;
    options.create_if_missing = true;
    options.compression = leveldb::kSnappyCompression;
    
    leveldb::Status status = leveldb::DB::Open(options, dbPath_, &db_);
    
    if (!status.ok()) {
        std::cerr << "Failed to open LevelDB: " << status.ToString() << std::endl;
        return false;
    }
    
    std::cout << "TerrainStorage initialized at: " << dbPath_ << std::endl;
    return true;
}

void TerrainStorage::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (db_) {
        db_.reset();
    }
}

std::string TerrainStorage::getChunkKey(int chunkX, int chunkY, int chunkZ) {
    std::ostringstream oss;
    oss << "chunk:" << chunkX << "," << chunkY << "," << chunkZ;
    return oss.str();
}

bool TerrainStorage::serializeModifications(
    const google::protobuf::RepeatedPtrField<VoxelModification>& mods,
    int64_t timestamp,
    std::string* output) {
    
    try {
        std::ostringstream oss;
        
        oss.write(reinterpret_cast<const char*>(&timestamp), sizeof(timestamp));
        
        int32_t count = mods.size();
        oss.write(reinterpret_cast<const char*>(&count), sizeof(count));
        
        for (const auto& mod : mods) {
            int32_t x = mod.local_x();
            int32_t y = mod.local_y();
            int32_t z = mod.local_z();
            float newDensity = mod.new_density();
            
            oss.write(reinterpret_cast<const char*>(&x), sizeof(x));
            oss.write(reinterpret_cast<const char*>(&y), sizeof(y));
            oss.write(reinterpret_cast<const char*>(&z), sizeof(z));
            oss.write(reinterpret_cast<const char*>(&newDensity), sizeof(newDensity));
        }
        
        *output = oss.str();
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Serialization error: " << e.what() << std::endl;
        return false;
    }
}

bool TerrainStorage::deserializeModifications(
    const std::string& data,
    google::protobuf::RepeatedPtrField<VoxelModification>* mods,
    int64_t* timestamp) {
    
    try {
        std::istringstream iss(data);
        
        iss.read(reinterpret_cast<char*>(timestamp), sizeof(*timestamp));
        
        int32_t count;
        iss.read(reinterpret_cast<char*>(&count), sizeof(count));
        
        mods->Clear();
        mods->Reserve(count);
        
        for (int32_t i = 0; i < count; ++i) {
            int32_t x, y, z;
            float newDensity;
            
            iss.read(reinterpret_cast<char*>(&x), sizeof(x));
            iss.read(reinterpret_cast<char*>(&y), sizeof(y));
            iss.read(reinterpret_cast<char*>(&z), sizeof(z));
            iss.read(reinterpret_cast<char*>(&newDensity), sizeof(newDensity));
            
            auto* mod = mods->Add();
            mod->set_local_x(x);
            mod->set_local_y(y);
            mod->set_local_z(z);
            mod->set_new_density(newDensity);
        }
        
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Deserialization error: " << e.what() << std::endl;
        return false;
    }
}

bool TerrainStorage::saveModifications(
    int chunkX, int chunkY, int chunkZ,
    const google::protobuf::RepeatedPtrField<VoxelModification>& mods,
    int64_t timestamp) {
    
    if (!db_) return false;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    const std::string key = getChunkKey(chunkX, chunkY, chunkZ);
    
    google::protobuf::RepeatedPtrField<VoxelModification> existingMods;
    int64_t existingTimestamp = 0;
    bool hasExisting = false;
    
    std::string existingData;
    leveldb::Status status = db_->Get(leveldb::ReadOptions(), key, &existingData);
    
    if (status.ok()) {
        hasExisting = deserializeModifications(existingData, &existingMods, &existingTimestamp);
    }
    
    google::protobuf::RepeatedPtrField<VoxelModification> mergedMods;
    
    std::map<std::tuple<int, int, int>, VoxelModification*> modMap;
    
    for (auto& mod : existingMods) {
        auto key = std::make_tuple(mod.local_x(), mod.local_y(), mod.local_z());
        modMap[key] = &mod;
    }
    
    for (const auto& mod : mods) {
        auto key = std::make_tuple(mod.local_x(), mod.local_y(), mod.local_z());
        auto it = modMap.find(key);
        
        if (it != modMap.end()) {
            it->second->set_new_density(mod.new_density());
        } else {
            auto* newMod = mergedMods.Add();
            newMod->CopyFrom(mod);
        }
    }
    
    for (auto& mod : existingMods) {
        auto key = std::make_tuple(mod.local_x(), mod.local_y(), mod.local_z());
        if (modMap.find(key) != modMap.end()) {
            auto* newMod = mergedMods.Add();
            newMod->CopyFrom(mod);
        }
    }
    
    std::string serialized;
    if (!serializeModifications(mergedMods, timestamp, &serialized)) {
        return false;
    }
    
    status = db_->Put(leveldb::WriteOptions(), key, serialized);
    
    if (!status.ok()) {
        std::cerr << "Failed to save modifications: " << status.ToString() << std::endl;
        return false;
    }
    
    return true;
}

bool TerrainStorage::getModifications(
    int chunkX, int chunkY, int chunkZ,
    google::protobuf::RepeatedPtrField<VoxelModification>* mods,
    int64_t* lastModified) {
    
    if (!db_) return false;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    const std::string key = getChunkKey(chunkX, chunkY, chunkZ);
    std::string data;
    
    leveldb::Status status = db_->Get(leveldb::ReadOptions(), key, &data);
    
    if (!status.ok()) {
        return false;
    }
    
    return deserializeModifications(data, mods, lastModified);
}

bool TerrainStorage::hasModifications(int chunkX, int chunkY, int chunkZ) {
    if (!db_) return false;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    const std::string key = getChunkKey(chunkX, chunkY, chunkZ);
    std::string data;
    
    leveldb::Status status = db_->Get(leveldb::ReadOptions(), key, &data);
    
    return status.ok();
}

bool TerrainStorage::applyModifications(int chunkX, int chunkY, int chunkZ, ChunkData* chunkData) {
    google::protobuf::RepeatedPtrField<VoxelModification> mods;
    int64_t lastModified = 0;
    
    if (!getModifications(chunkX, chunkY, chunkZ, &mods, &lastModified)) {
        return false;
    }
    
    const int size = chunkData->size();
    auto* densityField = chunkData->mutable_density_field();
    
    for (const auto& mod : mods) {
        const int x = mod.local_x();
        const int y = mod.local_y();
        const int z = mod.local_z();
        
        if (x >= 0 && x < size && y >= 0 && y < size && z >= 0 && z < size) {
            const int idx = z * size * size + y * size + x;
            if (idx < densityField->size()) {
                densityField->Set(idx, mod.new_density());
            }
        }
    }
    
    chunkData->set_has_modifications(true);
    return true;
}

} // namespace terrain
