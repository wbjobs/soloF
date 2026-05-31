class VectorClock {
  constructor(clock = {}) {
    this.clock = { ...clock };
  }

  increment(nodeId) {
    this.clock[nodeId] = (this.clock[nodeId] || 0) + 1;
    return this;
  }

  get(nodeId) {
    return this.clock[nodeId] || 0;
  }

  set(nodeId, value) {
    this.clock[nodeId] = value;
    return this;
  }

  merge(other) {
    const result = { ...this.clock };
    for (const [nodeId, value] of Object.entries(other.clock || other)) {
      result[nodeId] = Math.max(result[nodeId] || 0, value);
    }
    return new VectorClock(result);
  }

  compare(other) {
    let thisGreater = false;
    let otherGreater = false;
    const allKeys = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(other.clock || other)
    ]);

    for (const key of allKeys) {
      const thisVal = this.clock[key] || 0;
      const otherVal = (other.clock ? other.clock[key] : other[key]) || 0;
      
      if (thisVal > otherVal) thisGreater = true;
      if (otherVal > thisVal) otherGreater = true;
    }

    if (thisGreater && !otherGreater) return 1;
    if (otherGreater && !thisGreater) return -1;
    if (!thisGreater && !otherGreater) return 0;
    return 2;
  }

  isConcurrent(other) {
    return this.compare(other) === 2;
  }

  isGreaterThan(other) {
    return this.compare(other) === 1;
  }

  isLessThan(other) {
    return this.compare(other) === -1;
  }

  equal(other) {
    return this.compare(other) === 0;
  }

  clone() {
    return new VectorClock({ ...this.clock });
  }

  toJSON() {
    return { ...this.clock };
  }

  static fromJSON(json) {
    return new VectorClock(json);
  }

  toString() {
    return JSON.stringify(this.clock);
  }

  getTimestamp() {
    return Object.values(this.clock).reduce((a, b) => a + b, 0);
  }
}

export default VectorClock;
