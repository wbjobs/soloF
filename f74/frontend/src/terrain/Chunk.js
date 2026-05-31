import * as THREE from 'three';
import { MarchingCubes } from './MarchingCubes.js';

export class Chunk {
    constructor(chunkX, chunkY, chunkZ, size = 32) {
        this.chunkX = chunkX;
        this.chunkY = chunkY;
        this.chunkZ = chunkZ;
        this.size = size;
        this.lodLevel = 0;
        this.isLoaded = false;
        this.isGenerating = false;
        this.isDisposed = false;
        this.mesh = null;
        this.densityField = null;
        this.isoSurface = 0.0;
        this.lastUpdateTime = 0;
        this.distanceToCamera = 0;
    }

    loadData(chunkData) {
        this.densityField = new Float32Array(chunkData.densityField);
        this.isoSurface = chunkData.isoSurface;
        this.lodLevel = chunkData.lodLevel;
        this.isLoaded = true;
    }

    generateMesh() {
        if (this.isDisposed || !this.isLoaded || this.isGenerating) return null;
        
        this.isGenerating = true;
        
        try {
            const mc = new MarchingCubes(this.size, this.isoSurface);
            const geometry = mc.generate(
                this.densityField, 
                this.chunkX, 
                this.chunkY, 
                this.chunkZ, 
                this.lodLevel
            );

            if (this.isDisposed) {
                geometry.dispose();
                return null;
            }

            if (this.mesh) {
                this.mesh.geometry.dispose();
                if (this.mesh.material) {
                    if (Array.isArray(this.mesh.material)) {
                        this.mesh.material.forEach(m => m.dispose());
                    } else {
                        this.mesh.material.dispose();
                    }
                }
            }

            const material = this.createMaterial(this.lodLevel);
            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.castShadow = true;
            this.mesh.receiveShadow = true;
            this.mesh.userData.chunk = this;
            
            this.lastUpdateTime = performance.now();
            return this.mesh;
        } catch (e) {
            console.error('Error generating mesh:', e);
            return null;
        } finally {
            this.isGenerating = false;
        }
    }

    createMaterial(lodLevel) {
        const colors = [
            0x4a7c59,
            0x5a8c69,
            0x6a9c79,
            0x7aac89
        ];
        
        const color = colors[Math.min(lodLevel, colors.length - 1)];
        
        return new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.8,
            metalness: 0.1,
            flatShading: false
        });
    }

    updateLOD(newLodLevel) {
        if (this.isDisposed) return null;
        if (newLodLevel !== this.lodLevel && this.isLoaded) {
            this.lodLevel = newLodLevel;
            return this.generateMesh();
        }
        return null;
    }

    getPosition() {
        return new THREE.Vector3(
            this.chunkX * this.size + this.size / 2,
            this.chunkY * this.size + this.size / 2,
            this.chunkZ * this.size + this.size / 2
        );
    }

    getKey() {
        return `${this.chunkX},${this.chunkY},${this.chunkZ}`;
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.isLoaded = false;
        
        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
            }
            if (this.mesh.material) {
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach(m => m.dispose());
                } else {
                    this.mesh.material.dispose();
                }
            }
            this.mesh = null;
        }
        this.densityField = null;
    }

    getTriangleCount() {
        if (this.mesh && this.mesh.geometry) {
            const index = this.mesh.geometry.index;
            return index ? index.count / 3 : 0;
        }
        return 0;
    }
}
