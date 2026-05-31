import * as THREE from 'three';
import { Chunk } from './Chunk.js';

export class ChunkManager {
    constructor(scene, terrainService, options = {}) {
        this.scene = scene;
        this.terrainService = terrainService;
        this.chunkSize = options.chunkSize || 32;
        this.viewDistance = options.viewDistance || 4;
        this.lodDistances = options.lodDistances || [2, 4, 6, 8];
        
        this.chunks = new Map();
        this.loadingQueue = [];
        this.isStreaming = false;
        this.isDisposed = false;
        this.lastCameraPosition = new THREE.Vector3();
        this.updateInterval = 1000;
        this.lastUpdateTime = 0;
        
        this.maxConcurrentLoads = 4;
        this.activeLoads = 0;
        
        this.chunkGroup = new THREE.Group();
        this.scene.add(this.chunkGroup);
    }

    update(cameraPosition) {
        if (this.isDisposed) return;
        
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) return;
        
        this.lastUpdateTime = now;
        
        const distance = cameraPosition.distanceTo(this.lastCameraPosition);
        if (distance < this.chunkSize * 0.5) return;
        
        this.lastCameraPosition.copy(cameraPosition);
        
        this.updateChunks(cameraPosition);
        this.processLoadingQueue();
    }

    updateChunks(cameraPosition) {
        const camChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const camChunkY = Math.floor(cameraPosition.y / this.chunkSize);
        const camChunkZ = Math.floor(cameraPosition.z / this.chunkSize);

        const neededChunks = new Set();
        
        for (let x = -this.viewDistance; x <= this.viewDistance; x++) {
            for (let z = -this.viewDistance; z <= this.viewDistance; z++) {
                for (let y = -2; y <= 3; y++) {
                    const chunkX = camChunkX + x;
                    const chunkY = camChunkY + y;
                    const chunkZ = camChunkZ + z;
                    const key = `${chunkX},${chunkY},${chunkZ}`;
                    
                    const dist = Math.sqrt(x * x + y * y + z * z);
                    if (dist <= this.viewDistance) {
                        neededChunks.add(key);
                        
                        if (!this.chunks.has(key)) {
                            this.addChunkToQueue(chunkX, chunkY, chunkZ, dist);
                        } else {
                            this.updateChunkLOD(this.chunks.get(key), dist);
                        }
                    }
                }
            }
        }

        for (const [key, chunk] of this.chunks) {
            if (!neededChunks.has(key)) {
                this.unloadChunk(key);
            }
        }
    }

    addChunkToQueue(chunkX, chunkY, chunkZ, distance) {
        const key = `${chunkX},${chunkY},${chunkZ}`;
        
        if (this.chunks.has(key)) return;
        
        const lodLevel = this.getLODLevel(distance);
        this.loadingQueue.push({ chunkX, chunkY, chunkZ, lodLevel, distance, key });
        this.loadingQueue.sort((a, b) => a.distance - b.distance);
    }

    async processLoadingQueue() {
        if (this.isStreaming) return;
        if (this.activeLoads >= this.maxConcurrentLoads) return;
        if (this.loadingQueue.length === 0) return;

        while (this.loadingQueue.length > 0 && this.activeLoads < this.maxConcurrentLoads) {
            const item = this.loadingQueue.shift();
            
            if (this.chunks.has(item.key)) continue;
            
            this.activeLoads++;
            this.loadChunk(item.chunkX, item.chunkY, item.chunkZ, item.lodLevel)
                .finally(() => {
                    this.activeLoads--;
                });
        }
    }

    async loadChunk(chunkX, chunkY, chunkZ, lodLevel) {
        const key = `${chunkX},${chunkY},${chunkZ}`;
        
        if (this.chunks.has(key)) return;
        
        const chunk = new Chunk(chunkX, chunkY, chunkZ, this.chunkSize);
        this.chunks.set(key, chunk);
        
        try {
            const chunkData = await this.terrainService.getChunk(
                chunkX, chunkY, chunkZ, this.chunkSize, lodLevel
            );
            
            if (chunk.isDisposed) {
                this.chunks.delete(key);
                return;
            }
            
            chunk.loadData(chunkData);
            
            const mesh = chunk.generateMesh();
            if (mesh && !chunk.isDisposed) {
                this.chunkGroup.add(mesh);
            } else if (chunk.isDisposed) {
                this.chunks.delete(key);
            }
        } catch (e) {
            if (!chunk.isDisposed) {
                console.warn(`Failed to load chunk ${key}:`, e);
            }
            chunk.dispose();
            this.chunks.delete(key);
        }
    }

    async streamChunks(cameraPosition) {
        if (this.isStreaming) return;
        
        this.isStreaming = true;
        this.loadingQueue = [];
        
        try {
            await this.terrainService.streamChunks(
                cameraPosition.x,
                cameraPosition.y,
                cameraPosition.z,
                this.viewDistance,
                this.chunkSize,
                (chunkData) => {
                    const key = `${chunkData.chunkX},${chunkData.chunkY},${chunkData.chunkZ}`;
                    
                    if (!this.chunks.has(key) && !this.isDisposed) {
                        const chunk = new Chunk(
                            chunkData.chunkX,
                            chunkData.chunkY,
                            chunkData.chunkZ,
                            this.chunkSize
                        );
                        this.chunks.set(key, chunk);
                        chunk.loadData(chunkData);
                        
                        const mesh = chunk.generateMesh();
                        if (mesh && !chunk.isDisposed) {
                            this.chunkGroup.add(mesh);
                        } else if (chunk.isDisposed) {
                            this.chunks.delete(key);
                        }
                    }
                }
            );
        } catch (e) {
            if (!this.isDisposed) {
                console.warn('Stream chunks failed:', e);
            }
        } finally {
            this.isStreaming = false;
        }
    }

    updateChunkLOD(chunk, distance) {
        if (chunk.isDisposed) return;
        
        const newLodLevel = this.getLODLevel(distance);
        if (newLodLevel !== chunk.lodLevel) {
            const oldMesh = chunk.mesh;
            const newMesh = chunk.updateLOD(newLodLevel);
            if (newMesh && oldMesh !== newMesh && !chunk.isDisposed) {
                if (oldMesh) {
                    this.chunkGroup.remove(oldMesh);
                }
                this.chunkGroup.add(newMesh);
            }
        }
        chunk.distanceToCamera = distance;
    }

    getLODLevel(distance) {
        for (let i = this.lodDistances.length - 1; i >= 0; i--) {
            if (distance >= this.lodDistances[i]) {
                return i + 1;
            }
        }
        return 0;
    }

    unloadChunk(key) {
        const chunk = this.chunks.get(key);
        if (chunk) {
            if (chunk.mesh) {
                this.chunkGroup.remove(chunk.mesh);
            }
            chunk.dispose();
            this.chunks.delete(key);
        }
    }

    getLoadedChunkCount() {
        return this.chunks.size;
    }

    getTotalTriangleCount() {
        if (this.isDisposed) return 0;
        
        let count = 0;
        for (const chunk of this.chunks.values()) {
            count += chunk.getTriangleCount();
        }
        return Math.floor(count);
    }

    getCurrentLODLevel(cameraPosition) {
        if (this.isDisposed) return 0;
        
        let minDist = Infinity;
        let lodLevel = 0;
        
        for (const chunk of this.chunks.values()) {
            if (chunk.isDisposed) continue;
            const chunkPos = chunk.getPosition();
            const dist = cameraPosition.distanceTo(chunkPos);
            if (dist < minDist) {
                minDist = dist;
                lodLevel = chunk.lodLevel;
            }
        }
        
        return lodLevel;
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        
        for (const key of this.chunks.keys()) {
            this.unloadChunk(key);
        }
        this.scene.remove(this.chunkGroup);
        this.chunks.clear();
        this.loadingQueue = [];
    }
}
