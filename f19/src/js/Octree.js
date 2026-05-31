const THREE = require('three');

class OctreeNode {
  constructor(min, max, depth = 0) {
    this.min = min.clone();
    this.max = max.clone();
    this.center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    this.size = max.x - min.x;
    this.depth = depth;
    this.points = [];
    this.colors = [];
    this.children = [];
    this.isLeaf = true;
    this.pointCount = 0;
    this.boundingBox = new THREE.Box3(min, max);
    this.sphere = new THREE.Sphere(this.center, this.size * 0.866);
    this.mesh = null;
    this.boundingBoxMesh = null;
  }

  containsPoint(point) {
    return point.x >= this.min.x && point.x <= this.max.x &&
           point.y >= this.min.y && point.y <= this.max.y &&
           point.z >= this.min.z && point.z <= this.max.z;
  }

  split(maxDepth) {
    if (this.depth >= maxDepth) return;
    
    const mid = this.center;
    const min = this.min;
    const max = this.max;
    
    const octants = [
      [new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(mid.x, mid.y, mid.z)],
      [new THREE.Vector3(mid.x, min.y, min.z), new THREE.Vector3(max.x, mid.y, mid.z)],
      [new THREE.Vector3(min.x, mid.y, min.z), new THREE.Vector3(mid.x, max.y, mid.z)],
      [new THREE.Vector3(mid.x, mid.y, min.z), new THREE.Vector3(max.x, max.y, mid.z)],
      [new THREE.Vector3(min.x, min.y, mid.z), new THREE.Vector3(mid.x, mid.y, max.z)],
      [new THREE.Vector3(mid.x, min.y, mid.z), new THREE.Vector3(max.x, mid.y, max.z)],
      [new THREE.Vector3(min.x, mid.y, mid.z), new THREE.Vector3(mid.x, max.y, max.z)],
      [new THREE.Vector3(mid.x, mid.y, mid.z), new THREE.Vector3(max.x, max.y, max.z)]
    ];
    
    for (const [oMin, oMax] of octants) {
      const child = new OctreeNode(oMin, oMax, this.depth + 1);
      this.children.push(child);
    }
    
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const color = this.colors[i];
      for (const child of this.children) {
        if (child.containsPoint(point)) {
          child.points.push(point);
          child.colors.push(color);
          child.pointCount++;
          break;
        }
      }
    }
    
    this.points = [];
    this.colors = [];
    this.isLeaf = false;
    
    for (const child of this.children) {
      child.disposeMesh();
    }
  }

  createMesh(pointSize = 2.0) {
    if (this.points.length === 0) return null;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.points.length * 3);
    const colors = new Float32Array(this.points.length * 3);
    
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const c = this.colors[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: true
    });
    
    this.mesh = new THREE.Points(geometry, material);
    return this.mesh;
  }

  createBoundingBoxMesh() {
    const geometry = new THREE.Box3Helper(this.boundingBox, 0x00ff00);
    this.boundingBoxMesh = geometry;
    return geometry;
  }

  disposeMesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.boundingBoxMesh) {
      this.boundingBoxMesh.geometry.dispose();
      this.boundingBoxMesh.material.dispose();
      this.boundingBoxMesh = null;
    }
  }

  getDistanceToCamera(cameraPosition) {
    return this.center.distanceTo(cameraPosition);
  }

  getLODLevel(cameraPosition, lodDistanceFactor = 1.0) {
    const distance = this.getDistanceToCamera(cameraPosition);
    const threshold = this.size * lodDistanceFactor;
    
    if (distance < threshold * 0.5) return 2;
    if (distance < threshold) return 1;
    return 0;
  }
}

class OctreeLOD {
  constructor(points, colors, options = {}) {
    this.maxPointsPerNode = options.maxPointsPerNode || 50000;
    this.maxDepth = options.maxDepth || 8;
    this.lodDistanceFactor = options.lodDistanceFactor || 1.0;
    this.enableFrustumCulling = options.enableFrustumCulling !== false;
    this.pointSize = options.pointSize || 2.0;
    
    this.root = null;
    this.totalPoints = points.length;
    this.totalNodes = 0;
    this.visibleNodes = 0;
    this.renderedPoints = 0;
    this.activeMeshes = new Set();
    
    this.build(points, colors);
  }

  build(points, colors) {
    if (points.length === 0) return;
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }
    
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const halfSize = size / 2 + size * 0.05;
    
    const min = new THREE.Vector3(
      center.x - halfSize,
      center.y - halfSize,
      center.z - halfSize
    );
    const max = new THREE.Vector3(
      center.x + halfSize,
      center.y + halfSize,
      center.z + halfSize
    );
    
    this.root = new OctreeNode(min, max, 0);
    this.root.points = points;
    this.root.colors = colors;
    this.root.pointCount = points.length;
    
    this.splitRecursive(this.root);
    this.countNodes();
  }

  splitRecursive(node) {
    if (node.pointCount > this.maxPointsPerNode && node.depth < this.maxDepth) {
      node.split(this.maxDepth);
      for (const child of node.children) {
        this.splitRecursive(child);
      }
    }
  }

  countNodes() {
    this.totalNodes = 0;
    const traverse = (node) => {
      this.totalNodes++;
      for (const child of node.children) {
        traverse(child);
      }
    };
    if (this.root) traverse(this.root);
  }

  update(camera, frustum) {
    this.visibleNodes = 0;
    this.renderedPoints = 0;
    
    for (const mesh of this.activeMeshes) {
      mesh.visible = false;
    }
    this.activeMeshes.clear();
    
    this.traverseVisible(this.root, camera, frustum);
  }

  traverseVisible(node, camera, frustum) {
    if (!node) return;
    
    if (this.enableFrustumCulling && frustum) {
      if (!frustum.intersectsSphere(node.sphere)) {
        return;
      }
    }
    
    const lodLevel = node.getLODLevel(camera.position, this.lodDistanceFactor);
    
    if (node.isLeaf || lodLevel === 0) {
      this.renderNode(node);
      return;
    }
    
    if (lodLevel === 1 && node.pointCount > this.maxPointsPerNode * 0.5) {
      this.renderNode(node);
      return;
    }
    
    for (const child of node.children) {
      this.traverseVisible(child, camera, frustum);
    }
  }

  renderNode(node) {
    if (!node.mesh) {
      node.createMesh(this.pointSize);
    }
    
    if (node.mesh) {
      node.mesh.visible = true;
      this.activeMeshes.add(node.mesh);
      this.visibleNodes++;
      this.renderedPoints += node.pointCount;
    }
  }

  getAllMeshes() {
    const meshes = [];
    const traverse = (node) => {
      if (node.mesh) {
        meshes.push(node.mesh);
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    if (this.root) traverse(this.root);
    return meshes;
  }

  getAllBoundingBoxMeshes() {
    const meshes = [];
    const traverse = (node) => {
      if (!node.boundingBoxMesh) {
        node.createBoundingBoxMesh();
      }
      if (node.boundingBoxMesh) {
        meshes.push(node.boundingBoxMesh);
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    if (this.root) traverse(this.root);
    return meshes;
  }

  setPointSize(size) {
    this.pointSize = size;
    const traverse = (node) => {
      if (node.mesh) {
        node.mesh.material.size = size;
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    if (this.root) traverse(this.root);
  }

  setLODDistanceFactor(factor) {
    this.lodDistanceFactor = factor;
  }

  setFrustumCulling(enabled) {
    this.enableFrustumCulling = enabled;
  }

  dispose() {
    const traverse = (node) => {
      node.disposeMesh();
      for (const child of node.children) {
        traverse(child);
      }
    };
    if (this.root) traverse(this.root);
  }

  getStats() {
    return {
      totalPoints: this.totalPoints,
      renderedPoints: this.renderedPoints,
      totalNodes: this.totalNodes,
      visibleNodes: this.visibleNodes
    };
  }
}

module.exports = { OctreeLOD, OctreeNode };
