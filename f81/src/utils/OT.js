class Operation {
  constructor(type, key, value, oldValue, version) {
    this.type = type;
    this.key = key;
    this.value = value;
    this.oldValue = oldValue;
    this.version = version;
    this.timestamp = Date.now();
  }

  static set(key, value, oldValue, version) {
    return new Operation('set', key, value, oldValue, version);
  }

  static delete(key, oldValue, version) {
    return new Operation('delete', key, null, oldValue, version);
  }

  apply(config) {
    const result = { ...config };
    switch (this.type) {
      case 'set':
        result[this.key] = this.value;
        break;
      case 'delete':
        delete result[this.key];
        break;
    }
    return result;
  }

  toJSON() {
    return {
      type: this.type,
      key: this.key,
      value: this.value,
      oldValue: this.oldValue,
      version: this.version,
      timestamp: this.timestamp
    };
  }

  static fromJSON(json) {
    const op = new Operation(json.type, json.key, json.value, json.oldValue, json.version);
    op.timestamp = json.timestamp;
    return op;
  }
}

class OperationalTransform {
  static transform(op1, op2) {
    if (op1.key !== op2.key) {
      return [op1, op2];
    }

    if (op1.type === 'delete' && op2.type === 'delete') {
      return [null, null];
    }

    if (op1.type === 'delete' && op2.type === 'set') {
      return [op1, Operation.set(op2.key, op2.value, null, op2.version)];
    }

    if (op1.type === 'set' && op2.type === 'delete') {
      return [null, op2];
    }

    if (op1.type === 'set' && op2.type === 'set') {
      if (JSON.stringify(op1.value) === JSON.stringify(op2.value)) {
        return [op1, null];
      }
      if (op1.timestamp <= op2.timestamp) {
        return [op1, null];
      }
      return [null, op2];
    }

    return [op1, op2];
  }

  static transformAgainstOperations(op, concurrentOps) {
    let transformedOp = op;
    for (const concurrentOp of concurrentOps) {
      const [_, transformed] = this.transform(concurrentOp, transformedOp);
      if (!transformed) return null;
      transformedOp = transformed;
    }
    return transformedOp;
  }

  static merge(baseConfig, localOps, remoteOps, localClock, remoteClock) {
    const allOps = [...localOps, ...remoteOps];
    const causallyRelated = [];
    const concurrent = [];

    for (const op of allOps) {
      const opClock = op.version;
      if (localClock.isConcurrent(opClock)) {
        concurrent.push(op);
      } else {
        causallyRelated.push(op);
      }
    }

    const sortedConcurrent = concurrent.sort((a, b) => a.timestamp - b.timestamp);
    
    let result = { ...baseConfig };
    const mergedOps = [];

    for (const op of causallyRelated) {
      result = op.apply(result);
      mergedOps.push(op);
    }

    for (const op of sortedConcurrent) {
      const transformed = this.transformAgainstOperations(op, mergedOps);
      if (transformed) {
        result = transformed.apply(result);
        mergedOps.push(transformed);
      }
    }

    return { config: result, operations: mergedOps };
  }

  static detectConflicts(localOps, remoteOps) {
    const conflicts = [];
    const keyMap = new Map();

    for (const op of localOps) {
      if (!keyMap.has(op.key)) {
        keyMap.set(op.key, { local: [], remote: [] });
      }
      keyMap.get(op.key).local.push(op);
    }

    for (const op of remoteOps) {
      if (!keyMap.has(op.key)) {
        keyMap.set(op.key, { local: [], remote: [] });
      }
      keyMap.get(op.key).remote.push(op);
    }

    for (const [key, ops] of keyMap.entries()) {
      if (ops.local.length > 0 && ops.remote.length > 0) {
        const lastLocal = ops.local[ops.local.length - 1];
        const lastRemote = ops.remote[ops.remote.length - 1];
        
        if (lastLocal.timestamp !== lastRemote.timestamp &&
            JSON.stringify(lastLocal.value) !== JSON.stringify(lastRemote.value)) {
          conflicts.push({
            key,
            localOp: lastLocal,
            remoteOp: lastRemote
          });
        }
      }
    }

    return conflicts;
  }

  static resolveConflict(conflict, strategy = 'latest') {
    const { localOp, remoteOp } = conflict;
    
    switch (strategy) {
      case 'latest':
        return localOp.timestamp >= remoteOp.timestamp ? localOp : remoteOp;
      case 'local':
        return localOp;
      case 'remote':
        return remoteOp;
      case 'merge':
        if (typeof localOp.value === 'object' && typeof remoteOp.value === 'object') {
          return Operation.set(
            conflict.key,
            { ...localOp.value, ...remoteOp.value },
            localOp.oldValue,
            localOp.version
          );
        }
        return localOp.timestamp >= remoteOp.timestamp ? localOp : remoteOp;
      default:
        return localOp.timestamp >= remoteOp.timestamp ? localOp : remoteOp;
    }
  }
}

export { Operation, OperationalTransform };
export default OperationalTransform;
