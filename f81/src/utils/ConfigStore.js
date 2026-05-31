import VectorClock from './VectorClock';
import { Operation } from './OT';

class ConfigStore {
  constructor(dbName = 'config-sync-db') {
    this.dbName = dbName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('configs')) {
          db.createObjectStore('configs', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('nodeId', 'nodeId', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('operations')) {
          const opStore = db.createObjectStore('operations', { keyPath: 'id' });
          opStore.createIndex('timestamp', 'timestamp', { unique: false });
          opStore.createIndex('key', 'key', { unique: false });
        }
      };
    });
  }

  async saveConfig(config, vectorClock, nodeId) {
    const id = `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const record = {
      id,
      config: { ...config },
      vectorClock: vectorClock.toJSON(),
      nodeId,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['configs'], 'readwrite');
      const store = transaction.objectStore('configs');
      const request = store.put(record);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(id);
    });
  }

  async getLatestConfig() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['configs'], 'readonly');
      const store = transaction.objectStore('configs');
      const request = store.openCursor(null, 'prev');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          resolve({
            config: cursor.value.config,
            vectorClock: VectorClock.fromJSON(cursor.value.vectorClock)
          });
        } else {
          resolve({
            config: {},
            vectorClock: new VectorClock()
          });
        }
      };
    });
  }

  async saveOperation(operation, nodeId) {
    const id = `op_${operation.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    const record = {
      id,
      operation: operation.toJSON(),
      nodeId,
      timestamp: operation.timestamp
    };
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['operations'], 'readwrite');
      const store = transaction.objectStore('operations');
      const request = store.put(record);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(id);
    });
  }

  async getOperations(sinceTimestamp = 0) {
    return new Promise((resolve, reject) => {
      const operations = [];
      const transaction = this.db.transaction(['operations'], 'readonly');
      const store = transaction.objectStore('operations');
      const index = store.index('timestamp');
      const range = IDBKeyRange.lowerBound(sinceTimestamp);
      const request = index.openCursor(range);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          operations.push(Operation.fromJSON(cursor.value.operation));
          cursor.continue();
        } else {
          resolve(operations);
        }
      };
    });
  }

  async getOperationsByKey(key) {
    return new Promise((resolve, reject) => {
      const operations = [];
      const transaction = this.db.transaction(['operations'], 'readonly');
      const store = transaction.objectStore('operations');
      const index = store.index('key');
      const request = index.openCursor(IDBKeyRange.only(key));
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          operations.push(Operation.fromJSON(cursor.value.operation));
          cursor.continue();
        } else {
          resolve(operations);
        }
      };
    });
  }

  async saveHistory(snapshot) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');
      const request = store.put(snapshot);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getHistory(limit = 100) {
    return new Promise((resolve, reject) => {
      const history = [];
      const transaction = this.db.transaction(['history'], 'readonly');
      const store = transaction.objectStore('history');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      
      let count = 0;
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && count < limit) {
          history.push(cursor.value);
          count++;
          cursor.continue();
        } else {
          resolve(history);
        }
      };
    });
  }

  async clear() {
    const stores = ['configs', 'operations', 'history'];
    
    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export default ConfigStore;
