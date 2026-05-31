import { v4 as uuidv4 } from 'uuid';

class CRDTDocument {
  constructor() {
    this.operations = [];
    this.clock = 0;
    this.siteId = uuidv4();
    this.shapeStates = new Map();
    this.deletedShapes = new Set();
  }

  generateId() {
    this.clock++;
    return `${this.siteId}-${this.clock}`;
  }

  generateShapeId() {
    return `shape-${uuidv4()}`;
  }

  addOperation(type, data) {
    const shapeId = data.shapeId || this.generateShapeId();
    
    const operation = {
      id: this.generateId(),
      type,
      shapeId,
      data: {
        ...data,
        shapeId
      },
      timestamp: Date.now(),
      siteId: this.siteId
    };
    
    this.operations.push(operation);
    this.updateShapeState(operation);
    
    return operation;
  }

  updateShapeState(operation) {
    const { shapeId, type, data, timestamp, siteId } = operation;

    if (type === 'delete') {
      this.deletedShapes.add(shapeId);
      this.shapeStates.delete(shapeId);
      return;
    }

    if (this.deletedShapes.has(shapeId)) {
      return;
    }

    const existing = this.shapeStates.get(shapeId);
    
    if (!existing) {
      this.shapeStates.set(shapeId, {
        type,
        data,
        timestamp,
        siteId,
        lastOperationId: operation.id
      });
    } else {
      const shouldUpdate = 
        timestamp > existing.timestamp ||
        (timestamp === existing.timestamp && siteId.localeCompare(existing.siteId) > 0);
      
      if (shouldUpdate) {
        this.shapeStates.set(shapeId, {
          type,
          data,
          timestamp,
          siteId,
          lastOperationId: operation.id
        });
      }
    }
  }

  rebuildShapeStates() {
    this.shapeStates.clear();
    this.deletedShapes.clear();

    const sortedOps = [...this.operations].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.siteId.localeCompare(b.siteId);
    });

    for (const op of sortedOps) {
      this.updateShapeState(op);
    }
  }

  mergeOperations(remoteOperations) {
    const localIds = new Set(this.operations.map(op => op.id));
    const newOps = remoteOperations.filter(op => !localIds.has(op.id));
    
    if (newOps.length > 0) {
      this.operations.push(...newOps);
      this.rebuildShapeStates();
      return true;
    }
    return false;
  }

  getCurrentShapes() {
    return Array.from(this.shapeStates.values()).map(state => ({
      type: state.type,
      data: state.data,
      shapeId: state.data.shapeId,
      timestamp: state.timestamp
    }));
  }

  getState() {
    return { operations: [...this.operations] };
  }

  loadState(state) {
    if (state && state.operations) {
      this.operations = state.operations;
      
      const maxClock = Math.max(
        ...this.operations
          .filter(op => op.id && op.id.startsWith(this.siteId))
          .map(op => parseInt(op.id.split('-')[1]) || 0),
        0
      );
      this.clock = maxClock;
      
      this.rebuildShapeStates();
    }
  }

  getShapesUntil(timestamp) {
    const tempStates = new Map();
    const tempDeleted = new Set();

    const sortedOps = this.operations
      .filter(op => op.timestamp <= timestamp)
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return a.siteId.localeCompare(b.siteId);
      });

    for (const op of sortedOps) {
      const { shapeId, type, data, timestamp: ts, siteId } = op;

      if (type === 'delete') {
        tempDeleted.add(shapeId);
        tempStates.delete(shapeId);
        continue;
      }

      if (tempDeleted.has(shapeId)) {
        continue;
      }

      const existing = tempStates.get(shapeId);
      
      if (!existing) {
        tempStates.set(shapeId, {
          type,
          data,
          timestamp: ts,
          siteId
        });
      } else {
        const shouldUpdate = 
          ts > existing.timestamp ||
          (ts === existing.timestamp && siteId.localeCompare(existing.siteId) > 0);
        
        if (shouldUpdate) {
          tempStates.set(shapeId, {
            type,
            data,
            timestamp: ts,
            siteId
          });
        }
      }
    }

    return Array.from(tempStates.values()).map(state => ({
      type: state.type,
      data: state.data
    }));
  }

  clear() {
    this.operations = [];
    this.clock = 0;
    this.shapeStates.clear();
    this.deletedShapes.clear();
  }
}

export { CRDTDocument };
