import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const DB_PATH = './terrain_db.json';

class TerrainStorage {
    constructor(dbPath = DB_PATH) {
        this.dbPath = dbPath;
        this.modifications = new Map();
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
                for (const [key, value] of Object.entries(data)) {
                    this.modifications.set(key, value);
                }
                console.log(`📦 Loaded ${this.modifications.size} chunk modifications from disk`);
            }
        } catch (e) {
            console.warn('Failed to load terrain database:', e.message);
        }
    }

    save() {
        try {
            const data = {};
            for (const [key, value] of this.modifications) {
                data[key] = value;
            }
            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Failed to save terrain database:', e.message);
        }
    }

    getChunkKey(chunkX, chunkY, chunkZ) {
        return `${chunkX},${chunkY},${chunkZ}`;
    }

    saveModifications(chunkX, chunkY, chunkZ, modifications, timestamp) {
        const key = this.getChunkKey(chunkX, chunkY, chunkZ);
        
        if (!this.modifications.has(key)) {
            this.modifications.set(key, {
                modifications: [],
                lastModified: timestamp
            });
        }
        
        const chunkData = this.modifications.get(key);
        const existingMap = new Map();
        
        for (const mod of chunkData.modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            existingMap.set(k, mod);
        }
        
        for (const mod of modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            existingMap.set(k, mod);
        }
        
        chunkData.modifications = Array.from(existingMap.values());
        chunkData.lastModified = timestamp;
        
        this.save();
        return true;
    }

    getModifications(chunkX, chunkY, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkY, chunkZ);
        return this.modifications.get(key) || null;
    }

    applyModifications(chunkX, chunkY, chunkZ, chunkData) {
        const mods = this.getModifications(chunkX, chunkY, chunkZ);
        if (!mods || mods.modifications.length === 0) return false;
        
        const size = chunkData.size;
        const densityField = chunkData.densityField;
        
        for (const mod of mods.modifications) {
            const x = mod.localX;
            const y = mod.localY;
            const z = mod.localZ;
            
            if (x >= 0 && x < size && y >= 0 && y < size && z >= 0 && z < size) {
                const idx = z * size * size + y * size + x;
                if (idx < densityField.length) {
                    densityField[idx] = mod.newDensity;
                }
            }
        }
        
        chunkData.hasModifications = true;
        return true;
    }
}

const storage = new TerrainStorage();

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

const app = express();
const PORT = 50051;
const SEED = 1337;
const SCALE = 0.05;

const noise = new SimplexNoise(SEED);

app.use(cors());
app.use(express.json());

function generateChunkData(chunkX, chunkY, chunkZ, size, lodLevel) {
    const densityField = new Array(size * size * size);
    let index = 0;
    
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const worldX = (chunkX * size + x) * SCALE;
                const worldY = (chunkY * size + y) * SCALE;
                const worldZ = (chunkZ * size + z) * SCALE;
                
                let noiseVal = noise.fbm(worldX, worldY * 0.5, worldZ, 6, 0.5, 2.0);
                
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
            seed: SEED,
            frequency: 0.02,
            amplitude: 1.0,
            octaves: 6,
            persistence: 0.5,
            lacunarity: 2.0
        }
    };
}

app.post('/getChunk', (req, res) => {
    const { chunkX, chunkY, chunkZ, chunkSize, lodLevel } = req.body;
    
    console.log(`Get chunk: (${chunkX}, ${chunkY}, ${chunkZ}), size: ${chunkSize}, LOD: ${lodLevel}`);
    
    const data = generateChunkData(chunkX, chunkY, chunkZ, chunkSize, lodLevel);
    storage.applyModifications(chunkX, chunkY, chunkZ, data);
    res.json(data);
});

app.post('/editChunk', (req, res) => {
    const { chunkX, chunkY, chunkZ, chunkSize, modifications, timestamp } = req.body;
    
    const ts = timestamp || Date.now();
    const success = storage.saveModifications(chunkX, chunkY, chunkZ, modifications, ts);
    
    console.log(`✏️  Edit chunk (${chunkX}, ${chunkY}, ${chunkZ}): ${modifications.length} modifications`);
    
    res.json({
        success,
        message: success ? 'OK' : 'Failed',
        modifiedCount: modifications.length
    });
});

app.post('/batchEdit', (req, res) => {
    const { edits } = req.body;
    const timestamp = Date.now();
    let totalModified = 0;
    
    for (const edit of edits) {
        storage.saveModifications(
            edit.chunkX, edit.chunkY, edit.chunkZ,
            edit.modifications, timestamp
        );
        totalModified += edit.modifications.length;
    }
    
    console.log(`✏️  Batch edit: ${totalModified} modifications in ${edits.length} chunks`);
    
    res.json({
        success: true,
        message: 'OK',
        modifiedCount: totalModified
    });
});

app.post('/getChunkModifications', (req, res) => {
    const { chunkX, chunkY, chunkZ } = req.body;
    const mods = storage.getModifications(chunkX, chunkY, chunkZ);
    
    res.json({
        hasModifications: !!mods,
        modifications: mods ? mods.modifications : [],
        lastModified: mods ? mods.lastModified : 0
    });
});

app.post('/streamChunks', async (req, res) => {
    const { cameraX, cameraY, cameraZ, viewDistance, chunkSize } = req.body;
    
    console.log(`Stream chunks from camera: (${cameraX.toFixed(1)}, ${cameraY.toFixed(1)}, ${cameraZ.toFixed(1)}), viewDistance: ${viewDistance}`);
    
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
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    for (const chunk of chunks) {
        const data = generateChunkData(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunkSize, chunk.lodLevel);
        storage.applyModifications(chunk.chunkX, chunk.chunkY, chunk.chunkZ, data);
        res.write(JSON.stringify(data) + '\n');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    res.end();
    console.log(`Streamed ${chunks.length} chunks`);
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', seed: SEED });
});

app.listen(PORT, () => {
    console.log(`🚀 Terrain Server running on http://localhost:${PORT}`);
    console.log(`   Seed: ${SEED}`);
    console.log(`   Scale: ${SCALE}`);
    console.log(`   Database: ${DB_PATH}`);
    console.log();
    console.log('Endpoints:');
    console.log('   POST /getChunk             - Get single chunk');
    console.log('   POST /streamChunks         - Stream chunks around camera');
    console.log('   POST /editChunk            - Edit single chunk');
    console.log('   POST /batchEdit            - Batch edit multiple chunks');
    console.log('   POST /getChunkModifications - Get modifications for a chunk');
    console.log('   GET  /health               - Health check');
});
