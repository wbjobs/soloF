class SimplexNoise {
    constructor(seed = 1337) {
        this.perm = new Uint8Array(512);
        const rng = this.seededRandom(seed);
        
        for (let i = 0; i < 256; i++) {
            this.perm[i] = i;
        }
        
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
        }
        
        for (let i = 0; i < 256; i++) {
            this.perm[i + 256] = this.perm[i];
        }
    }

    seededRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(a, b, t) {
        return a + t * (b - a);
    }

    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        
        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);
        
        const A = this.perm[X] + Y;
        const AA = this.perm[A] + Z;
        const AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y;
        const BA = this.perm[B] + Z;
        const BB = this.perm[B + 1] + Z;
        
        return this.lerp(
            this.lerp(
                this.lerp(this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z), u),
                this.lerp(this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z), u),
                v
            ),
            this.lerp(
                this.lerp(this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1), u),
                this.lerp(this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1), u),
                v
            ),
            w
        );
    }

    fbm(x, y, z, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;
        
        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        
        return total / maxValue;
    }
}

export class MockTerrainService {
    constructor(seed = 1337) {
        this.noise = new SimplexNoise(seed);
        this.scale = 0.05;
        this.modifications = new Map();
    }

    async getChunk(chunkX, chunkY, chunkZ, chunkSize, lodLevel) {
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const size = chunkSize;
        const densityField = new Array(size * size * size);
        let index = 0;
        
        for (let z = 0; z < size; z++) {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const worldX = (chunkX * size + x) * this.scale;
                    const worldY = (chunkY * size + y) * this.scale;
                    const worldZ = (chunkZ * size + z) * this.scale;
                    
                    let noiseVal = this.noise.fbm(worldX, worldY * 0.5, worldZ, 6, 0.5, 2.0);
                    
                    const heightFactor = y / size;
                    const density = noiseVal + (0.5 - heightFactor) * 2.0;
                    
                    densityField[index++] = density;
                }
            }
        }
        
        return {
            chunkX,
            chunkY,
            chunkZ,
            size,
            lodLevel,
            isoSurface: 0.0,
            densityField,
            noiseSeed: {
                seed: 1337,
                frequency: 0.02,
                amplitude: 1.0,
                octaves: 6,
                persistence: 0.5,
                lacunarity: 2.0
            }
        };
    }

    async streamChunks(cameraX, cameraY, cameraZ, viewDistance, chunkSize, onChunkReceived) {
        const camChunkX = Math.floor(cameraX / chunkSize);
        const camChunkY = Math.floor(cameraY / chunkSize);
        const camChunkZ = Math.floor(cameraZ / chunkSize);
        
        const chunks = [];
        
        for (let x = -viewDistance; x <= viewDistance; x++) {
            for (let z = -viewDistance; z <= viewDistance; z++) {
                for (let y = -2; y <= 3; y++) {
                    const chunkX = camChunkX + x;
                    const chunkY = camChunkY + y;
                    const chunkZ = camChunkZ + z;
                    const distance = Math.sqrt(x * x + y * y + z * z);
                    
                    if (distance <= viewDistance) {
                        let lodLevel = 0;
                        if (distance > viewDistance * 0.75) lodLevel = 3;
                        else if (distance > viewDistance * 0.5) lodLevel = 2;
                        else if (distance > viewDistance * 0.25) lodLevel = 1;
                        
                        chunks.push({ chunkX, chunkY, chunkZ, lodLevel, distance });
                    }
                }
            }
        }
        
        chunks.sort((a, b) => a.distance - b.distance);
        
        for (const chunk of chunks) {
            const data = await this.getChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunkSize, chunk.lodLevel);
            onChunkReceived(data);
        }
    }

    async editChunk(editRequest) {
        const key = `${editRequest.chunkX},${editRequest.chunkY},${editRequest.chunkZ}`;
        
        if (!this.modifications.has(key)) {
            this.modifications.set(key, {
                modifications: [],
                lastModified: Date.now()
            });
        }
        
        const chunkMods = this.modifications.get(key);
        const existingMap = new Map();
        
        for (const mod of chunkMods.modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            existingMap.set(k, mod);
        }
        
        for (const mod of editRequest.modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            existingMap.set(k, mod);
        }
        
        chunkMods.modifications = Array.from(existingMap.values());
        chunkMods.lastModified = Date.now();
        
        console.log(`Saved ${editRequest.modifications.length} modifications for chunk ${key}`);
        
        return {
            success: true,
            message: 'OK',
            modifiedCount: editRequest.modifications.length
        };
    }

    async batchEdit(batchRequest) {
        let totalModified = 0;
        
        for (const edit of batchRequest.edits) {
            const result = await this.editChunk(edit);
            if (result.success) {
                totalModified += result.modifiedCount;
            }
        }
        
        return {
            success: true,
            message: 'OK',
            modifiedCount: totalModified
        };
    }

    async getChunkModifications(chunkX, chunkY, chunkZ) {
        const key = `${chunkX},${chunkY},${chunkZ}`;
        const chunkMods = this.modifications.get(key);
        
        if (chunkMods) {
            return {
                hasModifications: true,
                modifications: chunkMods.modifications,
                lastModified: chunkMods.lastModified
            };
        }
        
        return {
            hasModifications: false,
            modifications: [],
            lastModified: 0
        };
    }
}
