import * as THREE from 'three';

export class TerrainEditor {
    constructor(scene, camera, renderer, chunkManager, terrainService) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.chunkManager = chunkManager;
        this.terrainService = terrainService;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.isEnabled = false;
        this.isMining = false;
        this.mineRadius = 2;
        this.mineStrength = 0.5;
        this.maxMineDistance = 20;
        
        this.editMode = 'subtract';
        
        this.pendingEdits = new Map();
        this.flushInterval = 500;
        this.lastFlushTime = 0;
        
        this.hoverPoint = null;
        this.hoverNormal = null;
        this.hoverChunk = null;
        
        this.createEditIndicator();
        this.bindEvents();
    }

    createEditIndicator() {
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5
        });
        this.indicator = new THREE.Mesh(geometry, material);
        this.indicator.visible = false;
        this.scene.add(this.indicator);
        
        const radiusGeometry = new THREE.RingGeometry(1.5, 2, 32);
        const radiusMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        this.radiusIndicator = new THREE.Mesh(radiusGeometry, radiusMaterial);
        this.radiusIndicator.visible = false;
        this.scene.add(this.radiusIndicator);
    }

    bindEvents() {
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        
        this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);
        this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
        this.renderer.domElement.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('keydown', this.onKeyDown);
    }

    unbindEvents() {
        this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
        this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.renderer.domElement.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    onMouseMove(event) {
        if (!this.isEnabled) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.updateRaycast();
        
        if (this.isMining && this.hoverPoint) {
            this.performEdit();
        }
    }

    onMouseDown(event) {
        if (!this.isEnabled) return;
        if (event.button !== 0) return;
        
        this.isMining = true;
        if (this.hoverPoint) {
            this.performEdit();
        }
    }

    onMouseUp(event) {
        if (event.button !== 0) return;
        this.isMining = false;
    }

    onKeyDown(event) {
        if (!this.isEnabled) return;
        
        switch (event.code) {
            case 'KeyE':
                this.toggleEditMode();
                break;
            case 'BracketRight':
                this.mineRadius = Math.min(10, this.mineRadius + 0.5);
                console.log('Mine radius:', this.mineRadius);
                break;
            case 'BracketLeft':
                this.mineRadius = Math.max(0.5, this.mineRadius - 0.5);
                console.log('Mine radius:', this.mineRadius);
                break;
            case 'Digit1':
                this.editMode = 'subtract';
                console.log('Edit mode: subtract');
                break;
            case 'Digit2':
                this.editMode = 'add';
                console.log('Edit mode: add');
                break;
        }
    }

    toggleEditMode() {
        if (this.editMode === 'subtract') {
            this.editMode = 'add';
            this.indicator.material.color.setHex(0x00ff00);
        } else {
            this.editMode = 'subtract';
            this.indicator.material.color.setHex(0xff0000);
        }
        console.log('Edit mode:', this.editMode);
    }

    updateRaycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        this.raycaster.far = this.maxMineDistance;
        
        const meshes = [];
        for (const chunk of this.chunkManager.chunks.values()) {
            if (chunk.mesh && !chunk.isDisposed) {
                meshes.push(chunk.mesh);
            }
        }
        
        const intersects = this.raycaster.intersectObjects(meshes, false);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            this.hoverPoint = hit.point.clone();
            this.hoverNormal = hit.face.normal.clone();
            this.hoverChunk = hit.object.userData.chunk;
            
            this.indicator.position.copy(this.hoverPoint);
            this.indicator.visible = true;
            
            this.radiusIndicator.position.copy(this.hoverPoint);
            this.radiusIndicator.lookAt(this.hoverPoint.clone().add(this.hoverNormal));
            this.radiusIndicator.scale.setScalar(this.mineRadius);
            this.radiusIndicator.visible = true;
            
            document.body.style.cursor = 'crosshair';
        } else {
            this.hoverPoint = null;
            this.hoverNormal = null;
            this.hoverChunk = null;
            this.indicator.visible = false;
            this.radiusIndicator.visible = false;
            document.body.style.cursor = 'default';
        }
    }

    performEdit() {
        if (!this.hoverPoint || !this.hoverChunk) return;
        
        const affectedChunks = new Map();
        
        const editRadiusVoxels = this.mineRadius;
        const worldPos = this.hoverPoint;
        
        for (const chunk of this.chunkManager.chunks.values()) {
            if (chunk.isDisposed || !chunk.densityField) continue;
            
            const chunkPos = chunk.getPosition();
            const dist = worldPos.distanceTo(chunkPos);
            
            if (dist < this.chunkManager.chunkSize + editRadiusVoxels * 2) {
                this.editChunk(chunk, worldPos, editRadiusVoxels, affectedChunks);
            }
        }
        
        for (const [key, editData] of affectedChunks) {
            this.queueEdit(key, editData);
        }
    }

    editChunk(chunk, worldCenter, radius, affectedChunks) {
        const size = chunk.size;
        const densityField = chunk.densityField;
        
        const localX = worldCenter.x - chunk.chunkX * size;
        const localY = worldCenter.y - chunk.chunkY * size;
        const localZ = worldCenter.z - chunk.chunkZ * size;
        
        const minX = Math.max(0, Math.floor(localX - radius));
        const maxX = Math.min(size - 1, Math.ceil(localX + radius));
        const minY = Math.max(0, Math.floor(localY - radius));
        const maxY = Math.min(size - 1, Math.ceil(localY + radius));
        const minZ = Math.max(0, Math.floor(localZ - radius));
        const maxZ = Math.min(size - 1, Math.ceil(localZ + radius));
        
        const modifications = [];
        
        for (let z = minZ; z <= maxZ; z++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = x - localX;
                    const dy = y - localY;
                    const dz = z - localZ;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    
                    if (dist < radius) {
                        const idx = z * size * size + y * size + x;
                        const oldDensity = densityField[idx];
                        
                        const falloff = 1 - (dist / radius);
                        const delta = this.mineStrength * falloff * (this.editMode === 'subtract' ? -1 : 1);
                        
                        let newDensity = oldDensity + delta;
                        newDensity = Math.max(-1, Math.min(1, newDensity));
                        
                        if (Math.abs(newDensity - oldDensity) > 0.01) {
                            densityField[idx] = newDensity;
                            modifications.push({
                                localX: x,
                                localY: y,
                                localZ: z,
                                densityDelta: delta,
                                newDensity: newDensity
                            });
                        }
                    }
                }
            }
        }
        
        if (modifications.length > 0) {
            affectedChunks.set(chunk.getKey(), {
                chunkX: chunk.chunkX,
                chunkY: chunk.chunkY,
                chunkZ: chunk.chunkZ,
                chunkSize: size,
                modifications
            });
            
            chunk.generateMesh();
        }
    }

    queueEdit(key, editData) {
        if (!this.pendingEdits.has(key)) {
            this.pendingEdits.set(key, {
                chunkX: editData.chunkX,
                chunkY: editData.chunkY,
                chunkZ: editData.chunkZ,
                chunkSize: editData.chunkSize,
                modifications: []
            });
        }
        
        const pending = this.pendingEdits.get(key);
        const existingMap = new Map();
        
        for (const mod of pending.modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            existingMap.set(k, mod);
        }
        
        for (const mod of editData.modifications) {
            const k = `${mod.localX},${mod.localY},${mod.localZ}`;
            if (existingMap.has(k)) {
                const existing = existingMap.get(k);
                existing.newDensity = mod.newDensity;
                existing.densityDelta = mod.newDensity - (existing.newDensity - existing.densityDelta);
            } else {
                existingMap.set(k, mod);
                pending.modifications.push(mod);
            }
        }
    }

    flushPendingEdits() {
        if (this.pendingEdits.size === 0) return;
        
        const edits = Array.from(this.pendingEdits.values());
        this.pendingEdits.clear();
        
        if (this.terrainService && this.terrainService.batchEdit) {
            this.terrainService.batchEdit(edits)
                .then(response => {
                    if (!response.success) {
                        console.warn('Batch edit failed:', response.message);
                    }
                })
                .catch(e => {
                    console.warn('Failed to send edits:', e);
                });
        }
    }

    update(deltaTime) {
        if (!this.isEnabled) return;
        
        this.updateRaycast();
        
        const now = performance.now();
        if (now - this.lastFlushTime > this.flushInterval) {
            this.flushPendingEdits();
            this.lastFlushTime = now;
        }
    }

    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.indicator.visible = false;
            this.radiusIndicator.visible = false;
            this.isMining = false;
            document.body.style.cursor = 'default';
            this.flushPendingEdits();
        }
    }

    dispose() {
        this.setEnabled(false);
        this.unbindEvents();
        
        if (this.indicator) {
            this.scene.remove(this.indicator);
            this.indicator.geometry.dispose();
            this.indicator.material.dispose();
        }
        
        if (this.radiusIndicator) {
            this.scene.remove(this.radiusIndicator);
            this.radiusIndicator.geometry.dispose();
            this.radiusIndicator.material.dispose();
        }
    }
}
