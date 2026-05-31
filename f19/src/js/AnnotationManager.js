const THREE = require('three');

class AnnotationManager {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    this.isAnnotating = false;
    this.firstPoint = null;
    this.annotations = [];
    this.pointCloudMeshes = [];
    
    this.annotationGroup = new THREE.Group();
    this.scene.add(this.annotationGroup);
    
    this.markerGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xe94560, linewidth: 2 });
    this.startMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xe94560 });
    this.endMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    
    this.tempMarker = null;
    this.selectedAnnotation = null;
    
    this.onPointSelected = null;
    this.onAnnotationCreated = null;
    this.onAnnotationDeleted = null;
  }

  setPointCloudMeshes(meshes) {
    this.pointCloudMeshes = meshes;
  }

  enableAnnotationMode() {
    this.isAnnotating = true;
    this.firstPoint = null;
    this.updateCursor();
  }

  disableAnnotationMode() {
    this.isAnnotating = false;
    this.firstPoint = null;
    this.removeTempMarker();
    document.body.style.cursor = 'default';
  }

  updateCursor() {
    if (this.isAnnotating) {
      document.body.style.cursor = this.firstPoint ? 'crosshair' : 'pointer';
    }
  }

  handleClick(event, canvas) {
    if (!this.isAnnotating) return null;
    
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const intersects = this.raycaster.intersectObjects(this.pointCloudMeshes, false);
    
    if (intersects.length > 0) {
      const point = intersects[0].point.clone();
      
      if (!this.firstPoint) {
        this.firstPoint = point;
        this.createTempMarker(point, true);
        return { type: 'first_point', point };
      } else {
        const annotation = this.createAnnotation(this.firstPoint, point);
        this.annotations.push(annotation);
        this.firstPoint = null;
        this.removeTempMarker();
        
        if (this.onAnnotationCreated) {
          this.onAnnotationCreated(annotation);
        }
        
        return { type: 'annotation_created', annotation };
      }
    }
    
    return null;
  }

  createTempMarker(point, isStart) {
    this.removeTempMarker();
    const material = isStart ? this.startMarkerMaterial : this.endMarkerMaterial;
    this.tempMarker = new THREE.Mesh(this.markerGeometry, material);
    this.tempMarker.position.copy(point);
    this.annotationGroup.add(this.tempMarker);
  }

  removeTempMarker() {
    if (this.tempMarker) {
      this.annotationGroup.remove(this.tempMarker);
      this.tempMarker = null;
    }
  }

  createAnnotation(point1, point2) {
    const id = Date.now();
    const distance = point1.distanceTo(point2);
    const midPoint = new THREE.Vector3().addVectors(point1, point2).multiplyScalar(0.5);
    
    const annotation = {
      id,
      name: `测量 #${this.annotations.length + 1}`,
      point1: { x: point1.x, y: point1.y, z: point1.z },
      point2: { x: point2.x, y: point2.y, z: point2.z },
      distance,
      distanceMm: distance * 1000,
      createdAt: new Date().toISOString(),
      visual: {}
    };
    
    this.createVisualAnnotation(annotation);
    return annotation;
  }

  createVisualAnnotation(annotation) {
    const p1 = new THREE.Vector3(annotation.point1.x, annotation.point1.y, annotation.point1.z);
    const p2 = new THREE.Vector3(annotation.point2.x, annotation.point2.y, annotation.point2.z);
    
    const startMarker = new THREE.Mesh(this.markerGeometry, this.startMarkerMaterial);
    startMarker.position.copy(p1);
    this.annotationGroup.add(startMarker);
    
    const endMarker = new THREE.Mesh(this.markerGeometry, this.endMarkerMaterial);
    endMarker.position.copy(p2);
    this.annotationGroup.add(endMarker);
    
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeometry, this.lineMaterial);
    this.annotationGroup.add(line);
    
    annotation.visual = { startMarker, endMarker, line };
  }

  deleteAnnotation(id) {
    const index = this.annotations.findIndex(a => a.id === id);
    if (index === -1) return false;
    
    const annotation = this.annotations[index];
    
    if (annotation.visual) {
      this.annotationGroup.remove(annotation.visual.startMarker);
      this.annotationGroup.remove(annotation.visual.endMarker);
      this.annotationGroup.remove(annotation.visual.line);
      annotation.visual.startMarker.geometry.dispose();
      annotation.visual.endMarker.geometry.dispose();
      annotation.visual.line.geometry.dispose();
    }
    
    this.annotations.splice(index, 1);
    
    if (this.onAnnotationDeleted) {
      this.onAnnotationDeleted(id);
    }
    
    return true;
  }

  clearAllAnnotations() {
    for (const annotation of this.annotations) {
      if (annotation.visual) {
        this.annotationGroup.remove(annotation.visual.startMarker);
        this.annotationGroup.remove(annotation.visual.endMarker);
        this.annotationGroup.remove(annotation.visual.line);
        annotation.visual.startMarker.geometry.dispose();
        annotation.visual.endMarker.geometry.dispose();
        annotation.visual.line.geometry.dispose();
      }
    }
    this.annotations = [];
  }

  selectAnnotation(id) {
    if (this.selectedAnnotation && this.selectedAnnotation.id === id) {
      this.highlightAnnotation(this.selectedAnnotation, false);
      this.selectedAnnotation = null;
      return;
    }
    
    if (this.selectedAnnotation) {
      this.highlightAnnotation(this.selectedAnnotation, false);
    }
    
    this.selectedAnnotation = this.annotations.find(a => a.id === id);
    if (this.selectedAnnotation) {
      this.highlightAnnotation(this.selectedAnnotation, true);
    }
  }

  highlightAnnotation(annotation, highlight) {
    if (!annotation.visual) return;
    
    const scale = highlight ? 1.5 : 1;
    annotation.visual.startMarker.scale.setScalar(scale);
    annotation.visual.endMarker.scale.setScalar(scale);
    
    annotation.visual.line.material.color.setHex(highlight ? 0xffff00 : 0xe94560);
  }

  exportCSV() {
    const headers = ['ID', '名称', '点1 X', '点1 Y', '点1 Z', '点2 X', '点2 Y', '点2 Z', '距离(单位)', '距离(mm)', '创建时间'];
    const rows = this.annotations.map(a => [
      a.id,
      a.name,
      a.point1.x.toFixed(6),
      a.point1.y.toFixed(6),
      a.point1.z.toFixed(6),
      a.point2.x.toFixed(6),
      a.point2.y.toFixed(6),
      a.point2.z.toFixed(6),
      a.distance.toFixed(6),
      a.distanceMm.toFixed(3),
      a.createdAt
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  exportJSON() {
    return JSON.stringify({
      exportTime: new Date().toISOString(),
      count: this.annotations.length,
      annotations: this.annotations.map(a => ({
        id: a.id,
        name: a.name,
        point1: a.point1,
        point2: a.point2,
        distance: a.distance,
        distanceMm: a.distanceMm,
        createdAt: a.createdAt
      }))
    }, null, 2);
  }

  renameAnnotation(id, newName) {
    const annotation = this.annotations.find(a => a.id === id);
    if (annotation) {
      annotation.name = newName;
      return true;
    }
    return false;
  }

  getAnnotations() {
    return this.annotations;
  }

  hasFirstPoint() {
    return this.firstPoint !== null;
  }

  dispose() {
    this.clearAllAnnotations();
    this.scene.remove(this.annotationGroup);
  }
}

module.exports = { AnnotationManager };
