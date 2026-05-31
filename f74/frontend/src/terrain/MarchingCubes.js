import { EDGE_TABLE } from './edgeTable.js';
import { TRI_TABLE } from './triTable.js';
import * as THREE from 'three';

export class MarchingCubes {
    constructor(size = 32, isoLevel = 0.0) {
        this.size = size;
        this.isoLevel = isoLevel;
        this.vertices = [];
        this.normals = [];
        this.indices = [];
        this.vertexCount = 0;
    }

    generate(densityField, chunkX, chunkY, chunkZ, lodLevel = 0) {
        this.vertices = [];
        this.normals = [];
        this.indices = [];
        this.vertexCount = 0;

        const step = 1 << lodLevel;
        const gridSize = this.size;
        const sizeMinus = gridSize - 1;

        const voxelSize = 1.0;
        const offsetX = chunkX * gridSize;
        const offsetY = chunkY * gridSize;
        const offsetZ = chunkZ * gridSize;

        const cubeCorners = new Float32Array(8);
        const cubePositions = new Array(8);

        for (let z = 0; z < sizeMinus; z += step) {
            for (let y = 0; y < sizeMinus; y += step) {
                for (let x = 0; x < sizeMinus; x += step) {
                    let cubeIndex = 0;

                    for (let i = 0; i < 8; i++) {
                        const dx = (i & 1);
                        const dy = ((i >> 1) & 1);
                        const dz = ((i >> 2) & 1);
                        
                        const ix = Math.min(x + dx * step, sizeMinus);
                        const iy = Math.min(y + dy * step, sizeMinus);
                        const iz = Math.min(z + dz * step, sizeMinus);
                        
                        const idx = iz * gridSize * gridSize + iy * gridSize + ix;
                        cubeCorners[i] = densityField[idx];
                        
                        cubePositions[i] = new THREE.Vector3(
                            (offsetX + ix) * voxelSize,
                            (offsetY + iy) * voxelSize,
                            (offsetZ + iz) * voxelSize
                        );

                        if (cubeCorners[i] < this.isoLevel) {
                            cubeIndex |= (1 << i);
                        }
                    }

                    if (cubeIndex === 0 || cubeIndex === 255) {
                        continue;
                    }

                    const edgeFlags = EDGE_TABLE[cubeIndex];
                    if (edgeFlags === 0) continue;

                    const edgeVertices = new Array(12);
                    const edgeNormals = new Array(12);

                    for (let i = 0; i < 12; i++) {
                        if (edgeFlags & (1 << i)) {
                            const edge = this.EDGE_CONNECTIONS[i];
                            const v1 = cubeCorners[edge[0]];
                            const v2 = cubeCorners[edge[1]];
                            const p1 = cubePositions[edge[0]];
                            const p2 = cubePositions[edge[1]];

                            const t = this.interpolate(v1, v2, this.isoLevel);
                            
                            edgeVertices[i] = new THREE.Vector3(
                                p1.x + t * (p2.x - p1.x),
                                p1.y + t * (p2.y - p1.y),
                                p1.z + t * (p2.z - p1.z)
                            );

                            const n1 = this.calculateNormal(densityField, 
                                Math.floor(p1.x - offsetX), 
                                Math.floor(p1.y - offsetY), 
                                Math.floor(p1.z - offsetZ), 
                                gridSize);
                            const n2 = this.calculateNormal(densityField, 
                                Math.floor(p2.x - offsetX), 
                                Math.floor(p2.y - offsetY), 
                                Math.floor(p2.z - offsetZ), 
                                gridSize);
                            
                            edgeNormals[i] = new THREE.Vector3(
                                n1.x + t * (n2.x - n1.x),
                                n1.y + t * (n2.y - n1.y),
                                n1.z + t * (n2.z - n1.z)
                            ).normalize();
                        }
                    }

                    const triList = TRI_TABLE[cubeIndex];
                    if (!triList) continue;

                    for (let i = 0; i < triList.length; i += 3) {
                        for (let j = 0; j < 3; j++) {
                            const edgeIdx = triList[i + j];
                            const v = edgeVertices[edgeIdx];
                            const n = edgeNormals[edgeIdx];
                            
                            if (v && n) {
                                this.vertices.push(v.x, v.y, v.z);
                                this.normals.push(n.x, n.y, n.z);
                                this.indices.push(this.vertexCount++);
                            }
                        }
                    }
                }
            }
        }

        return this.createGeometry();
    }

    interpolate(v1, v2, iso) {
        const delta = v2 - v1;
        if (Math.abs(delta) < 0.00001) return 0.5;
        return (iso - v1) / delta;
    }

    calculateNormal(densityField, x, y, z, gridSize) {
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        
        const x0 = clamp(x - 1, 0, gridSize - 1);
        const x1 = clamp(x + 1, 0, gridSize - 1);
        const y0 = clamp(y - 1, 0, gridSize - 1);
        const y1 = clamp(y + 1, 0, gridSize - 1);
        const z0 = clamp(z - 1, 0, gridSize - 1);
        const z1 = clamp(z + 1, 0, gridSize - 1);

        const dx = densityField[z * gridSize * gridSize + y * gridSize + x1] - 
                   densityField[z * gridSize * gridSize + y * gridSize + x0];
        const dy = densityField[z * gridSize * gridSize + y1 * gridSize + x] - 
                   densityField[z * gridSize * gridSize + y0 * gridSize + x];
        const dz = densityField[z1 * gridSize * gridSize + y * gridSize + x] - 
                   densityField[z0 * gridSize * gridSize + y * gridSize + x];

        return new THREE.Vector3(dx, dy, dz).normalize();
    }

    createGeometry() {
        const geometry = new THREE.BufferGeometry();
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setIndex(this.indices);

        return geometry;
    }

    static get EDGE_CONNECTIONS() {
        return [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
        ];
    }
}
