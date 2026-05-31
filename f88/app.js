import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/addons/renderers/webgpu/WebGPURenderer.js';

class LightSimulation {
    constructor() {
        this.canvas = document.getElementById('webgpu-canvas');
        this.loadingEl = document.getElementById('loading');
        
        this.params = {
            lightPos: new THREE.Vector3(0, 5, -5),
            n1: 1.0,
            n2: 1.5,
            surfaceShape: 'plane',
            sphereRadius: 4,
            maxBounces: 10,
            rayCount: 3,
            showRays: true,
            dispersion: true,
            n2Red: 1.51,
            n2Green: 1.52,
            n2Blue: 1.53
        };
        
        this.rayObjects = [];
        this.intersectionPoints = [];
        this.intersectionData = [];
        
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.fps = 60;
        
        this.init();
    }
    
    async init() {
        try {
            await this.setupRenderer();
            this.setupScene();
            this.setupControls();
            this.createSurfaces();
            this.createLightSource();
            this.setupEventListeners();
            this.updateRays();
            this.validateSnellLaw();
            this.animate();
            
            this.loadingEl.style.display = 'none';
        } catch (e) {
            console.log('WebGPU 不可用，回退到 WebGL:', e.message);
            this.setupWebGLRenderer();
            this.setupScene();
            this.setupControls();
            this.createSurfaces();
            this.createLightSource();
            this.setupEventListeners();
            this.updateRays();
            this.validateSnellLaw();
            this.animate();
            
            this.loadingEl.style.display = 'none';
        }
    }
    
    async setupRenderer() {
        this.renderer = new WebGPURenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth - 320, window.innerHeight);
        this.renderer.setClearColor(0x0a0a1a, 1);
    }
    
    setupWebGLRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth - 320, window.innerHeight);
        this.renderer.setClearColor(0x0a0a1a, 1);
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera(
            60,
            (window.innerWidth - 320) / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(10, 8, 15);
        
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 20, 10);
        this.scene.add(directionalLight);
        
        this.createGrid();
    }
    
    createGrid() {
        const gridHelper = new THREE.GridHelper(30, 30, 0x333366, 0x222244);
        this.scene.add(gridHelper);
        
        const axesHelper = new THREE.AxesHelper(10);
        this.scene.add(axesHelper);
    }
    
    setupControls() {
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 50;
    }
    
    createSurfaces() {
        if (this.surfaceMesh) {
            this.scene.remove(this.surfaceMesh);
        }
        
        if (this.params.surfaceShape === 'plane') {
            const geometry = new THREE.PlaneGeometry(20, 20);
            const material = new THREE.MeshPhysicalMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                metalness: 0.1,
                roughness: 0.1
            });
            this.surfaceMesh = new THREE.Mesh(geometry, material);
            this.surfaceMesh.rotation.x = Math.PI / 2;
            this.surfaceMesh.position.y = 0;
        } else {
            const geometry = new THREE.SphereGeometry(this.params.sphereRadius, 64, 64);
            const material = new THREE.MeshPhysicalMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                metalness: 0.1,
                roughness: 0.1
            });
            this.surfaceMesh = new THREE.Mesh(geometry, material);
            this.surfaceMesh.position.y = this.params.sphereRadius - 1;
        }
        
        this.scene.add(this.surfaceMesh);
        
        const wireframeGeometry = new THREE.WireframeGeometry(this.surfaceMesh.geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x6699ff, opacity: 0.3, transparent: true });
        this.wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        this.wireframe.position.copy(this.surfaceMesh.position);
        this.wireframe.rotation.copy(this.surfaceMesh.rotation);
        this.scene.add(this.wireframe);
    }
    
    createLightSource() {
        if (this.lightMesh) {
            this.scene.remove(this.lightMesh);
        }
        
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xffff00,
            emissive: 0xffff00
        });
        this.lightMesh = new THREE.Mesh(geometry, material);
        this.lightMesh.position.copy(this.params.lightPos);
        this.scene.add(this.lightMesh);
        
        const glowGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00,
            transparent: true,
            opacity: 0.3
        });
        this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        this.glowMesh.position.copy(this.params.lightPos);
        this.scene.add(this.glowMesh);
    }
    
    getSurfaceNormal(point) {
        if (this.params.surfaceShape === 'plane') {
            return new THREE.Vector3(0, 1, 0);
        } else {
            const center = new THREE.Vector3(0, this.params.sphereRadius - 1, 0);
            const normal = point.clone().sub(center).normalize();
            return normal;
        }
    }
    
    intersectSurface(origin, direction) {
        if (this.params.surfaceShape === 'plane') {
            const planeY = 0;
            if (Math.abs(direction.y) < 0.0001) return null;
            
            const t = (planeY - origin.y) / direction.y;
            if (t < 0.001) return null;
            
            const point = origin.clone().add(direction.clone().multiplyScalar(t));
            if (Math.abs(point.x) > 10 || Math.abs(point.z) > 10) return null;
            
            return {
                point: point,
                distance: t,
                normal: this.getSurfaceNormal(point)
            };
        } else {
            const center = new THREE.Vector3(0, this.params.sphereRadius - 1, 0);
            const oc = origin.clone().sub(center);
            const dir = direction.clone().normalize();
            
            const a = dir.dot(dir);
            const b = 2 * oc.dot(dir);
            const c = oc.dot(oc) - this.params.sphereRadius * this.params.sphereRadius;
            
            const discriminant = b * b - 4 * a * c;
            if (discriminant < 0) return null;
            
            const sqrtDisc = Math.sqrt(discriminant);
            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);
            
            let t = null;
            const distFromCenter = origin.distanceTo(center);
            const isInside = distFromCenter < this.params.sphereRadius - 0.001;
            
            if (isInside) {
                t = t2 > 0.001 ? t2 : null;
            } else {
                t = t1 > 0.001 ? t1 : (t2 > 0.001 ? t2 : null);
            }
            
            if (!t) return null;
            
            const point = origin.clone().add(dir.multiplyScalar(t));
            return {
                point: point,
                distance: t,
                normal: this.getSurfaceNormal(point)
            };
        }
    }
    
    reflect(direction, normal) {
        const v = direction.clone().normalize();
        const n = normal.clone().normalize();
        const dot = v.dot(n);
        return v.clone().sub(n.clone().multiplyScalar(2 * dot)).normalize();
    }
    
    refract(direction, normal, n1, n2) {
        const v = direction.clone().normalize();
        let n = normal.clone().normalize();
        
        let cosTheta1 = -v.dot(n);
        
        if (cosTheta1 < 0) {
            cosTheta1 = -cosTheta1;
            n = n.negate();
        }
        
        const ratio = n1 / n2;
        const sinTheta2Sq = ratio * ratio * (1 - cosTheta1 * cosTheta1);
        
        if (sinTheta2Sq > 1.0) {
            return null;
        }
        
        const cosTheta2 = Math.sqrt(1 - sinTheta2Sq);
        const refracted = v.clone().multiplyScalar(ratio)
            .add(n.clone().multiplyScalar(ratio * cosTheta1 - cosTheta2))
            .normalize();
        
        return refracted;
    }
    
    fresnel(direction, normal, n1, n2) {
        const v = direction.clone().normalize();
        let n = normal.clone().normalize();
        
        let cosTheta = -v.dot(n);
        if (cosTheta < 0) {
            cosTheta = -cosTheta;
            n = n.negate();
        }
        
        let sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        
        if (n1 > n2) {
            const sinCritical = n2 / n1;
            if (sinTheta > sinCritical) {
                return 1;
            }
        }
        
        const r0 = Math.pow((n1 - n2) / (n1 + n2), 2);
        const r = r0 + (1 - r0) * Math.pow(1 - cosTheta, 5);
        return r;
    }
    
    traceRay(origin, direction, maxBounces, n2Override = null) {
        const path = [];
        const intersections = [];
        let energy = 1.0;
        let currentPos = origin.clone();
        let currentDir = direction.clone().normalize();
        let inMedium = false;
        
        const n2Value = n2Override !== null ? n2Override : this.params.n2;
        
        path.push({
            point: currentPos.clone(),
            energy: energy,
            type: 'source'
        });
        
        for (let bounce = 0; bounce < maxBounces; bounce++) {
            const intersection = this.intersectSurface(currentPos, currentDir);
            
            if (!intersection) {
                const endPoint = currentPos.clone().add(currentDir.clone().multiplyScalar(50));
                path.push({
                    point: endPoint,
                    energy: energy,
                    type: 'exit'
                });
                break;
            }
            
            const n1 = inMedium ? n2Value : this.params.n1;
            const n2 = inMedium ? this.params.n1 : n2Value;
            
            const reflectRatio = this.fresnel(currentDir, intersection.normal, n1, n2);
            const refractRatio = 1 - reflectRatio;
            
            intersections.push({
                point: intersection.point.clone(),
                normal: intersection.normal.clone(),
                incidentDir: currentDir.clone(),
                energy: energy,
                reflectRatio: reflectRatio,
                refractRatio: refractRatio,
                bounce: bounce + 1,
                n1: n1,
                n2: n2,
                inMedium: inMedium
            });
            
            const refractedDir = this.refract(currentDir, intersection.normal, n1, n2);
            
            if (refractedDir) {
                path.push({
                    point: intersection.point.clone(),
                    energy: energy * refractRatio,
                    type: inMedium ? 'exit' : 'enter',
                    normal: intersection.normal.clone()
                });
                
                currentPos = intersection.point.clone();
                currentDir = refractedDir;
                energy *= refractRatio * 0.95;
                inMedium = !inMedium;
            } else {
                const reflectedDir = this.reflect(currentDir, intersection.normal);
                path.push({
                    point: intersection.point.clone(),
                    energy: energy * reflectRatio,
                    type: 'reflect',
                    normal: intersection.normal.clone()
                });
                
                currentPos = intersection.point.clone();
                currentDir = reflectedDir;
                energy *= reflectRatio * 0.95;
            }
            
            if (energy < 0.01) break;
        }
        
        return { path, intersections };
    }
    
    createBezierCurve(p0, p1, normal, type) {
        const midPoint = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
        
        if (normal) {
            const offset = normal.clone().multiplyScalar(0.3);
            midPoint.add(offset);
        }
        
        const curve = new THREE.QuadraticBezierCurve3(p0, midPoint, p1);
        return curve;
    }
    
    createRayLine(points, color) {
        if (points.length < 2) return null;
        
        if (this.params.surfaceShape === 'sphere') {
            const linePoints = points.map(p => p.point);
            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const material = new THREE.LineBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.9,
                linewidth: 3
            });
            return new THREE.Line(geometry, material);
        }
        
        const curves = [];
        for (let i = 0; i < points.length - 1; i++) {
            const curve = this.createBezierCurve(
                points[i].point,
                points[i + 1].point,
                points[i].normal,
                points[i].type
            );
            curves.push(curve);
        }
        
        const allPoints = [];
        curves.forEach(curve => {
            const curvePoints = curve.getPoints(20);
            allPoints.push(...curvePoints);
        });
        
        const geometry = new THREE.BufferGeometry().setFromPoints(allPoints);
        
        const material = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            linewidth: 2
        });
        
        return new THREE.Line(geometry, material);
    }
    
    createRainbowRay(origin, direction, maxBounces) {
        const rayObjects = [];
        
        if (this.params.dispersion) {
            const channels = [
                { n2: this.params.n2Red, color: new THREE.Color(0xff6666) },
                { n2: this.params.n2Green, color: new THREE.Color(0x66ff66) },
                { n2: this.params.n2Blue, color: new THREE.Color(0x6688ff) }
            ];
            
            const allPaths = [];
            
            for (let c = 0; c < 3; c++) {
                const channel = channels[c];
                const { path, intersections } = this.traceRay(
                    origin,
                    direction,
                    maxBounces,
                    channel.n2
                );
                
                allPaths.push({ path, color: channel.color });
                
                if (c === 1) {
                    this.intersectionData.push(...intersections);
                }
                
                const linePoints = path.map(p => p.point);
                const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
                const material = new THREE.LineBasicMaterial({
                    color: channel.color,
                    transparent: true,
                    opacity: 0.6,
                    linewidth: 1
                });
                const line = new THREE.Line(geometry, material);
                rayObjects.push(line);
            }
            
            const ribbon = this.createRainbowRibbon(allPaths);
            if (ribbon) rayObjects.push(ribbon);
            
        } else {
            const { path, intersections } = this.traceRay(origin, direction, maxBounces);
            this.intersectionData.push(...intersections);
            
            const color = new THREE.Color(0xffff88);
            const rayLine = this.createRayLine(path, color);
            if (rayLine) rayObjects.push(rayLine);
        }
        
        return rayObjects;
    }
    
    createRainbowRibbon(allPaths) {
        try {
            const redPath = allPaths[0].path;
            const greenPath = allPaths[1].path;
            const bluePath = allPaths[2].path;
            
            const maxPoints = Math.min(redPath.length, greenPath.length, bluePath.length);
            if (maxPoints < 2) return null;
            
            const ribbonGroup = new THREE.Group();
            const stripCount = 5;
            
            for (let i = 0; i < maxPoints - 1; i++) {
                const redStart = redPath[i].point;
                const redEnd = redPath[i + 1].point;
                const blueStart = bluePath[i].point;
                const blueEnd = bluePath[i + 1].point;
                
                const dir = new THREE.Vector3().subVectors(redEnd, redStart).normalize();
                const spreadStart = new THREE.Vector3().subVectors(blueStart, redStart);
                const spreadEnd = new THREE.Vector3().subVectors(blueEnd, redEnd);
                
                if (spreadStart.length() < 0.001 && spreadEnd.length() < 0.001) continue;
                
                for (let s = 0; s < stripCount; s++) {
                    const t = s / (stripCount - 1);
                    const hue = 0.65 - t * 0.7;
                    const color = new THREE.Color().setHSL(hue, 1, 0.6);
                    
                    const p1 = new THREE.Vector3().lerpVectors(redStart, blueStart, t);
                    const p2 = new THREE.Vector3().lerpVectors(redEnd, blueEnd, t);
                    
                    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                    const dist = p1.distanceTo(p2);
                    
                    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
                    const lineMat = new THREE.LineBasicMaterial({
                        color: color,
                        transparent: true,
                        opacity: 0.5
                    });
                    const line = new THREE.Line(lineGeo, lineMat);
                    ribbonGroup.add(line);
                }
            }
            
            return ribbonGroup;
        } catch (e) {
            console.log('Ribbon creation error:', e);
            return null;
        }
    }
    
    updateRays() {
        this.rayObjects.forEach(obj => this.scene.remove(obj));
        this.rayObjects = [];
        this.intersectionData = [];
        
        if (!this.params.showRays) return;
        
        const rayCount = Math.min(this.params.rayCount, 3);
        const spreadAngle = Math.PI / 8;
        
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / (rayCount - 1) - 0.5) * spreadAngle;
            const direction = new THREE.Vector3(
                Math.sin(angle),
                -0.85,
                0.5
            ).normalize();
            
            const rayObjs = this.createRainbowRay(
                this.params.lightPos,
                direction,
                this.params.maxBounces
            );
            
            rayObjs.forEach(obj => {
                this.scene.add(obj);
                this.rayObjects.push(obj);
            });
        }
        
        this.addIntersectionMarkers();
    }
    
    addIntersectionMarkers() {
        const uniquePoints = new Map();
        
        this.intersectionData.forEach(data => {
            const key = `${data.point.x.toFixed(2)},${data.point.y.toFixed(2)},${data.point.z.toFixed(2)}`;
            if (!uniquePoints.has(key)) {
                uniquePoints.set(key, data);
            }
        });
        
        uniquePoints.forEach((data, key) => {
            const markerGeometry = new THREE.SphereGeometry(0.08, 8, 8);
            const markerMaterial = new THREE.MeshBasicMaterial({
                color: data.inMedium ? 0x4444ff : 0x44ff44,
                transparent: true,
                opacity: 0.8
            });
            const marker = new THREE.Mesh(markerGeometry, markerMaterial);
            marker.position.copy(data.point);
            marker.userData = { ...data };
            this.scene.add(marker);
            this.rayObjects.push(marker);
        });
    }
    
    validateSnellLaw() {
        const testCases = [
            { incident: new THREE.Vector3(0, -1, 0), normal: new THREE.Vector3(0, 1, 0), n1: 1.0, n2: 1.5, desc: '垂直入射 air->glass' },
            { incident: new THREE.Vector3(0.5, -0.866, 0), normal: new THREE.Vector3(0, 1, 0), n1: 1.0, n2: 1.5, desc: '30度入射 air->glass' },
            { incident: new THREE.Vector3(0.707, -0.707, 0), normal: new THREE.Vector3(0, 1, 0), n1: 1.0, n2: 1.5, desc: '45度入射 air->glass' },
            { incident: new THREE.Vector3(0.3, -0.954, 0), normal: new THREE.Vector3(0, -1, 0), n1: 1.5, n2: 1.0, desc: '内部出射 glass->air' },
        ];
        
        console.log('=== Snell定律验证测试 ===');
        testCases.forEach((test, idx) => {
            const refracted = this.refract(test.incident, test.normal, test.n1, test.n2);
            const cosTheta1 = -test.incident.clone().normalize().dot(test.normal.clone().normalize());
            const theta1 = Math.acos(Math.abs(cosTheta1)) * 180 / Math.PI;
            
            let theta2 = null;
            if (refracted) {
                const cosTheta2 = refracted.dot(test.normal.clone().normalize().negate());
                theta2 = Math.acos(Math.abs(cosTheta2)) * 180 / Math.PI;
            }
            
            console.log(`测试 ${idx + 1}: ${test.desc}`);
            console.log(`  入射角: ${theta1.toFixed(2)}°, n1=${test.n1}, n2=${test.n2}`);
            if (refracted) {
                console.log(`  折射角: ${theta2.toFixed(2)}°`);
                console.log(`  Snell验证: ${test.n1} * sin(${theta1.toFixed(2)}°) = ${(test.n1 * Math.sin(theta1 * Math.PI / 180)).toFixed(4)}`);
                console.log(`                ${test.n2} * sin(${theta2.toFixed(2)}°) = ${(test.n2 * Math.sin(theta2 * Math.PI / 180)).toFixed(4)}`);
            } else {
                console.log(`  全反射发生`);
            }
            console.log('');
        });
    }
    
    setupEventListeners() {
        window.addEventListener('resize', () => this.onResize());
        
        document.getElementById('lightX').addEventListener('input', (e) => {
            this.params.lightPos.x = parseFloat(e.target.value);
            document.getElementById('lightXVal').textContent = e.target.value;
            this.updateLightAndRays();
        });
        
        document.getElementById('lightY').addEventListener('input', (e) => {
            this.params.lightPos.y = parseFloat(e.target.value);
            document.getElementById('lightYVal').textContent = e.target.value;
            this.updateLightAndRays();
        });
        
        document.getElementById('lightZ').addEventListener('input', (e) => {
            this.params.lightPos.z = parseFloat(e.target.value);
            document.getElementById('lightZVal').textContent = e.target.value;
            this.updateLightAndRays();
        });
        
        document.getElementById('n1').addEventListener('change', (e) => {
            this.params.n1 = parseFloat(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('n2').addEventListener('change', (e) => {
            this.params.n2 = parseFloat(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('mediumSelect').addEventListener('change', (e) => {
            const value = parseFloat(e.target.value);
            this.params.n2 = value;
            document.getElementById('n2').value = value;
            this.updateRays();
        });
        
        document.getElementById('surfaceShape').addEventListener('change', (e) => {
            this.params.surfaceShape = e.target.value;
            document.getElementById('sphereControls').style.display = 
                e.target.value === 'sphere' ? 'block' : 'none';
            this.createSurfaces();
            this.updateRays();
        });
        
        document.getElementById('sphereRadius').addEventListener('input', (e) => {
            this.params.sphereRadius = parseFloat(e.target.value);
            document.getElementById('sphereRadiusVal').textContent = e.target.value;
            this.createSurfaces();
            this.updateRays();
        });
        
        document.getElementById('maxBounces').addEventListener('change', (e) => {
            this.params.maxBounces = parseInt(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('rayCount').addEventListener('input', (e) => {
            this.params.rayCount = parseInt(e.target.value);
            document.getElementById('rayCountVal').textContent = e.target.value;
            this.updateRays();
        });
        
        document.getElementById('dispersionToggle').addEventListener('change', (e) => {
            this.params.dispersion = e.target.checked;
            document.getElementById('dispersionControls').style.display = 
                e.target.checked ? 'block' : 'none';
            this.updateRays();
        });
        
        document.getElementById('n2Red').addEventListener('change', (e) => {
            this.params.n2Red = parseFloat(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('n2Green').addEventListener('change', (e) => {
            this.params.n2Green = parseFloat(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('n2Blue').addEventListener('change', (e) => {
            this.params.n2Blue = parseFloat(e.target.value);
            this.updateRays();
        });
        
        document.getElementById('presetCrown').addEventListener('click', () => {
            this.params.n2Red = 1.520;
            this.params.n2Green = 1.525;
            this.params.n2Blue = 1.530;
            document.getElementById('n2Red').value = 1.520;
            document.getElementById('n2Green').value = 1.525;
            document.getElementById('n2Blue').value = 1.530;
            this.updateRays();
        });
        
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.camera.position.set(10, 8, 15);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        });
        
        document.getElementById('toggleRays').addEventListener('click', () => {
            this.params.showRays = !this.params.showRays;
            this.updateRays();
        });
        
        this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
    }
    
    updateLightAndRays() {
        this.lightMesh.position.copy(this.params.lightPos);
        this.glowMesh.position.copy(this.params.lightPos);
        this.updateRays();
    }
    
    onCanvasClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        
        const intersects = raycaster.intersectObjects(this.rayObjects);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            this.showIntersectionInfo(point);
            this.createClickMarker(point);
        }
    }
    
    showIntersectionInfo(point) {
        let nearestIntersection = null;
        let minDist = Infinity;
        
        this.intersectionData.forEach(data => {
            const dist = data.point.distanceTo(point);
            if (dist < minDist && dist < 1) {
                minDist = dist;
                nearestIntersection = data;
            }
        });
        
        const content = document.getElementById('intersectionContent');
        
        if (nearestIntersection) {
            const attenuation = ((1 - nearestIntersection.energy) * 100).toFixed(1);
            
            const v = nearestIntersection.incidentDir.clone().normalize();
            let n = nearestIntersection.normal.clone().normalize();
            let cosTheta1 = -v.dot(n);
            if (cosTheta1 < 0) {
                cosTheta1 = -cosTheta1;
                n = n.negate();
            }
            const theta1 = Math.acos(cosTheta1) * 180 / Math.PI;
            
            let theta2 = null;
            const refracted = this.refract(nearestIntersection.incidentDir, nearestIntersection.normal, nearestIntersection.n1, nearestIntersection.n2);
            if (refracted) {
                const cosTheta2 = refracted.dot(n.negate());
                theta2 = Math.acos(Math.abs(cosTheta2)) * 180 / Math.PI;
            }
            
            content.innerHTML = `
                <div class="intersection-item">
                    <strong>坐标:</strong><br>
                    X: ${nearestIntersection.point.x.toFixed(3)}<br>
                    Y: ${nearestIntersection.point.y.toFixed(3)}<br>
                    Z: ${nearestIntersection.point.z.toFixed(3)}
                </div>
                <div class="intersection-item">
                    <strong>交点信息:</strong><br>
                    反射次数: ${nearestIntersection.bounce}<br>
                    剩余能量: ${(nearestIntersection.energy * 100).toFixed(1)}%<br>
                    能量衰减: ${attenuation}%
                </div>
                <div class="intersection-item">
                    <strong>折射角度 (Snell定律):</strong><br>
                    n1: ${nearestIntersection.n1.toFixed(2)}, n2: ${nearestIntersection.n2.toFixed(2)}<br>
                    入射角 θ1: ${theta1.toFixed(2)}°<br>
                    ${theta2 !== null ? `折射角 θ2: ${theta2.toFixed(2)}°` : '全反射 (TIR)'}<br>
                    ${theta2 !== null ? `验证: n1·sin(θ1) = ${(nearestIntersection.n1 * Math.sin(theta1 * Math.PI / 180)).toFixed(4)}<br>n2·sin(θ2) = ${(nearestIntersection.n2 * Math.sin(theta2 * Math.PI / 180)).toFixed(4)}` : ''}
                </div>
                <div class="intersection-item">
                    <strong>菲涅尔系数:</strong><br>
                    反射率: ${(nearestIntersection.reflectRatio * 100).toFixed(1)}%<br>
                    透射率: ${(nearestIntersection.refractRatio * 100).toFixed(1)}%
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="intersection-item">
                    <strong>点击坐标:</strong><br>
                    X: ${point.x.toFixed(3)}<br>
                    Y: ${point.y.toFixed(3)}<br>
                    Z: ${point.z.toFixed(3)}
                </div>
                <div style="opacity:0.6;margin-top:8px;">
                    点击光线交点查看详细信息
                </div>
            `;
        }
    }
    
    createClickMarker(point) {
        if (this.clickMarker) {
            this.scene.remove(this.clickMarker);
        }
        
        const geometry = new THREE.RingGeometry(0.3, 0.5, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        this.clickMarker = new THREE.Mesh(geometry, material);
        this.clickMarker.position.copy(point);
        this.clickMarker.lookAt(this.camera.position);
        this.scene.add(this.clickMarker);
        
        setTimeout(() => {
            if (this.clickMarker) {
                this.scene.remove(this.clickMarker);
                this.clickMarker = null;
            }
        }, 2000);
    }
    
    onResize() {
        const width = window.innerWidth - 320;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.controls.update();
        
        if (this.glowMesh) {
            const scale = 1 + Math.sin(Date.now() * 0.003) * 0.1;
            this.glowMesh.scale.setScalar(scale);
        }
        
        this.renderer.render(this.scene, this.camera);
        
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            
            const fpsEl = document.getElementById('fps-counter');
            if (fpsEl) {
                fpsEl.textContent = `FPS: ${this.fps}`;
                fpsEl.style.color = this.fps >= 55 ? '#4ade80' : 
                                   this.fps >= 30 ? '#fbbf24' : '#ef4444';
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new LightSimulation();
});
