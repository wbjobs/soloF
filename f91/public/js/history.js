const DB_NAME = 'WebRTC_CRDT_Editor';
const DB_VERSION = 1;
const STORE_ROOMS = 'rooms';
const STORE_HISTORY = 'history';

export class HistoryStore {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (evt) => {
        const db = evt.target.result;
        if (!db.objectStoreNames.contains(STORE_ROOMS)) {
          const roomStore = db.createObjectStore(STORE_ROOMS, { keyPath: 'id' });
          roomStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const histStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
          histStore.createIndex('roomId', 'roomId', { unique: false });
          histStore.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveRoomMeta(roomId, meta = {}) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_ROOMS, 'readwrite');
      const store = tx.objectStore(STORE_ROOMS);
      const getReq = store.get(roomId);
      getReq.onsuccess = () => {
        const existing = getReq.result || { id: roomId, createdAt: Date.now() };
        const updated = { ...existing, ...meta, updatedAt: Date.now() };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getRoomMeta(roomId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_ROOMS, 'readonly');
      const req = tx.objectStore(STORE_ROOMS).get(roomId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async listRooms() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_ROOMS, 'readonly');
      const req = tx.objectStore(STORE_ROOMS).index('updatedAt').openCursor(null, 'prev');
      const results = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async appendHistory(roomId, entry) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      const record = {
        roomId,
        ts: Date.now(),
        ...entry,
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getHistory(roomId, limit = 1000) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const idx = store.index('roomId');
      const range = IDBKeyRange.only(roomId);
      const req = idx.openCursor(range, 'prev');
      const results = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results.reverse());
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async exportJSON(roomId) {
    const meta = await this.getRoomMeta(roomId);
    const history = await this.getHistory(roomId, Infinity);
    return {
      version: 1,
      exportedAt: Date.now(),
      roomId,
      meta,
      history,
    };
  }

  async clearRoom(roomId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_ROOMS, STORE_HISTORY], 'readwrite');
      tx.objectStore(STORE_ROOMS).delete(roomId);
      const histStore = tx.objectStore(STORE_HISTORY);
      const idx = histStore.index('roomId');
      const range = IDBKeyRange.only(roomId);
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
    });
  }

  close() {
    if (this.db) this.db.close();
  }
}
