import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import localforage from "localforage";
import type { Note } from "@/types";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const STORAGE_KEY = "f99-notes-db";
const META_KEY = "f99-notes-db-meta";
const DB_FILENAME = "notes.db";

let sqlPromise: Promise<SqlJsStatic> | null = null;
let dbInstance: LocalDb | null = null;

function loadSql(): Promise<SqlJsStatic> {
  if (sqlPromise) return sqlPromise;
  sqlPromise = initSqlJs({
    locateFile: () => sqlWasmUrl,
  });
  return sqlPromise;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createNotesTable(db: SqlJsDatabase) {
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      server_updated_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      user_id TEXT
    );
  `);
}

function trySetupFts5(db: SqlJsDatabase): boolean {
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content, content='notes', content_rowid='rowid');`);
    db.run(`DROP TRIGGER IF EXISTS notes_ai;`);
    db.run(`DROP TRIGGER IF EXISTS notes_ad;`);
    db.run(`DROP TRIGGER IF EXISTS notes_au;`);
    db.run(`
      CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
    `);
    db.run(`
      CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
      END;
    `);
    db.run(`
      CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
    `);
    db.run(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild');`);
    return true;
  } catch (e) {
    console.warn("[db] FTS5 not available, fallback to LIKE search:", e);
    return false;
  }
}

function ensureNotesTableExists(db: SqlJsDatabase): boolean {
  try {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'");
    return res.length > 0 && res[0].values.length > 0;
  } catch {
    return false;
  }
}

export class LocalDb {
  private db: SqlJsDatabase;
  private SQL: SqlJsStatic;
  private fts5Enabled: boolean = false;

  constructor(SQL: SqlJsStatic, db: SqlJsDatabase, fts5Enabled: boolean) {
    this.SQL = SQL;
    this.db = db;
    this.fts5Enabled = fts5Enabled;
  }

  private async persist() {
    const data = this.db.export();
    await localforage.setItem(STORAGE_KEY, data.buffer);
    await localforage.setItem(META_KEY, { savedAt: Date.now() });
  }

  private run(sql: string, params: (string | number | null)[] = []) {
    this.db.run(sql, params);
  }

  private all<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
    const res = this.db.exec(sql, params);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => (obj[c] = row[i]));
      return obj as T;
    });
  }

  private first<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T | null {
    const rows = this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  static async open(): Promise<LocalDb> {
    if (dbInstance) return dbInstance;
    const SQL = await loadSql();
    let db: SqlJsDatabase;
    let fts5Enabled = false;

    const buffer = await localforage.getItem<ArrayBuffer>(STORAGE_KEY);
    if (buffer) {
      try {
        db = new SQL.Database(new Uint8Array(buffer));
        if (!ensureNotesTableExists(db)) {
          console.warn("[db] Existing DB missing notes table, recreating...");
          db.close();
          db = new SQL.Database();
          createNotesTable(db);
        }
      } catch (e) {
        console.warn("[db] Failed to open existing DB, creating new one:", e);
        db = new SQL.Database();
        createNotesTable(db);
      }
    } else {
      db = new SQL.Database();
      createNotesTable(db);
    }

    fts5Enabled = trySetupFts5(db);

    dbInstance = new LocalDb(SQL, db, fts5Enabled);
    await dbInstance.persist();
    return dbInstance;
  }

  isFts5Enabled() {
    return this.fts5Enabled;
  }

  async close() {
    await this.persist();
    this.db.close();
    dbInstance = null;
  }

  async listNotes(): Promise<Note[]> {
    const rows = this.all<Note>(
      `SELECT * FROM notes WHERE deleted = 0 ORDER BY updated_at DESC`
    );
    return rows;
  }

  async getNote(id: string): Promise<Note | null> {
    return this.first<Note>(`SELECT * FROM notes WHERE id = ? AND deleted = 0`, [id]);
  }

  async searchNotes(query: string): Promise<Note[]> {
    const q = query.trim();
    if (!q) return this.listNotes();
    if (this.fts5Enabled) {
      try {
        const escaped = q.replace(/"/g, '""');
        const ftsQuery = `"${escaped}"*`;
        const rows = this.all<Note>(
          `SELECT n.* FROM notes n
           INNER JOIN notes_fts f ON f.rowid = n.rowid
           WHERE notes_fts MATCH ? AND n.deleted = 0
           ORDER BY rank
           LIMIT 100`,
          [ftsQuery]
        );
        return rows;
      } catch {
        // Fall through to LIKE
      }
    }
    const like = `%${q}%`;
    return this.all<Note>(
      `SELECT * FROM notes WHERE deleted = 0 AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC`,
      [like, like]
    );
  }

  async createNote(partial: Partial<Note> & { title: string; content: string; user_id?: string | null }): Promise<Note> {
    const now = new Date().toISOString();
    const note: Note = {
      id: partial.id || uid(),
      title: partial.title,
      content: partial.content,
      created_at: partial.created_at || now,
      updated_at: partial.updated_at || now,
      server_updated_at: partial.server_updated_at ?? null,
      dirty: partial.dirty ?? 1,
      deleted: partial.deleted ?? 0,
      user_id: partial.user_id ?? null,
    };
    this.run(
      `INSERT OR REPLACE INTO notes (id, title, content, created_at, updated_at, server_updated_at, dirty, deleted, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.title,
        note.content,
        note.created_at,
        note.updated_at,
        note.server_updated_at,
        note.dirty,
        note.deleted,
        note.user_id,
      ]
    );
    await this.persist();
    return note;
  }

  async updateNote(id: string, patch: Partial<Note>, markDirty: boolean = true): Promise<Note | null> {
    const existing = await this.getNote(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged: Note = {
      ...existing,
      ...patch,
      updated_at: patch.updated_at || now,
      dirty: markDirty ? 1 : patch.dirty ?? existing.dirty,
    };
    this.run(
      `UPDATE notes SET title=?, content=?, updated_at=?, server_updated_at=?, dirty=?, deleted=?, user_id=? WHERE id=?`,
      [
        merged.title,
        merged.content,
        merged.updated_at,
        merged.server_updated_at,
        merged.dirty,
        merged.deleted,
        merged.user_id,
        id,
      ]
    );
    await this.persist();
    return merged;
  }

  async deleteNote(id: string, markDirty: boolean = true): Promise<void> {
    const now = new Date().toISOString();
    this.run(
      `UPDATE notes SET deleted = 1, updated_at = ?, dirty = ? WHERE id = ?`,
      [now, markDirty ? 1 : 0, id]
    );
    await this.persist();
  }

  async getDirtyNotes(): Promise<Note[]> {
    return this.all<Note>(
      `SELECT * FROM notes WHERE dirty = 1 ORDER BY updated_at ASC`
    );
  }

  async clearDirty(id: string, serverUpdatedAt: string): Promise<void> {
    this.run(
      `UPDATE notes SET dirty = 0, server_updated_at = ? WHERE id = ?`,
      [serverUpdatedAt, id]
    );
    await this.persist();
  }

  async applyRemoteNote(remote: Note): Promise<void> {
    const existing = await this.first<Note>(`SELECT * FROM notes WHERE id = ?`, [remote.id]);
    if (existing) {
      this.run(
        `UPDATE notes SET title=?, content=?, created_at=?, updated_at=?, server_updated_at=?, dirty=0, deleted=?, user_id=? WHERE id=?`,
        [
          remote.title,
          remote.content,
          remote.created_at,
          remote.updated_at,
          remote.server_updated_at,
          remote.deleted,
          remote.user_id,
          remote.id,
        ]
      );
    } else {
      this.run(
        `INSERT OR REPLACE INTO notes (id, title, content, created_at, updated_at, server_updated_at, dirty, deleted, user_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          remote.id,
          remote.title,
          remote.content,
          remote.created_at,
          remote.updated_at,
          remote.server_updated_at,
          remote.deleted,
          remote.user_id,
        ]
      );
    }
    await this.persist();
  }

  async exportDb(): Promise<Uint8Array> {
    return this.db.export();
  }

  async importDb(buffer: ArrayBuffer): Promise<void> {
    const SQL = this.SQL;
    const tempDb = new SQL.Database(new Uint8Array(buffer));
    
    if (!ensureNotesTableExists(tempDb)) {
      tempDb.close();
      throw new Error("Invalid database file: missing notes table");
    }

    const notes = tempDb.exec("SELECT * FROM notes");
    tempDb.close();

    if (!notes.length) {
      throw new Error("Invalid database file: no data found");
    }

    const { columns, values } = notes[0];
    const colIndex = (name: string) => columns.indexOf(name);
    
    this.run(`DELETE FROM notes`);
    
    for (const row of values) {
      this.run(
        `INSERT OR REPLACE INTO notes (id, title, content, created_at, updated_at, server_updated_at, dirty, deleted, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(row[colIndex("id")] ?? uid()),
          String(row[colIndex("title")] ?? ""),
          String(row[colIndex("content")] ?? ""),
          String(row[colIndex("created_at")] ?? new Date().toISOString()),
          String(row[colIndex("updated_at")] ?? new Date().toISOString()),
          row[colIndex("server_updated_at")] ? String(row[colIndex("server_updated_at")]) : null,
          Number(row[colIndex("dirty")] ?? 1),
          Number(row[colIndex("deleted")] ?? 0),
          row[colIndex("user_id")] ? String(row[colIndex("user_id")]) : null,
        ]
      );
    }

    if (this.fts5Enabled) {
      try {
        this.db.run(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild');`);
      } catch {
        // ignore
      }
    }
    
    await this.persist();
  }

  async clearAll(): Promise<void> {
    this.run(`DELETE FROM notes`);
    if (this.fts5Enabled) {
      try {
        this.db.run(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild');`);
      } catch {
        // ignore
      }
    }
    await this.persist();
  }

  getDbFilename() {
    return DB_FILENAME;
  }
}

export async function getDb(): Promise<LocalDb> {
  return LocalDb.open();
}
