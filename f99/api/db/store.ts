import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "server-data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted: boolean;
}

function ensureFile(file: string, init: string) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, init, "utf8");
}

ensureFile(USERS_FILE, "[]");
ensureFile(NOTES_FILE, "[]");

function readJson<T>(file: string): T[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T[];
  } catch {
    return [];
  }
}

function writeJson<T>(file: string, data: T[]) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export const usersRepo = {
  list: (): UserRow[] => readJson<UserRow>(USERS_FILE),
  findByEmail: (email: string): UserRow | undefined =>
    readJson<UserRow>(USERS_FILE).find((u) => u.email.toLowerCase() === email.toLowerCase()),
  findById: (id: string): UserRow | undefined =>
    readJson<UserRow>(USERS_FILE).find((u) => u.id === id),
  insert: (user: UserRow) => {
    const rows = readJson<UserRow>(USERS_FILE);
    rows.push(user);
    writeJson(USERS_FILE, rows);
  },
};

export const notesRepo = {
  list: (): NoteRow[] => readJson<NoteRow>(NOTES_FILE),
  listForUser: (userId: string): NoteRow[] =>
    readJson<NoteRow>(NOTES_FILE).filter((n) => n.user_id === userId),
  listChangedAfter: (userId: string, after: string | null): NoteRow[] => {
    const rows = readJson<NoteRow>(NOTES_FILE).filter((n) => n.user_id === userId);
    if (!after) return rows;
    return rows.filter((n) => n.server_updated_at > after);
  },
  findById: (id: string): NoteRow | undefined =>
    readJson<NoteRow>(NOTES_FILE).find((n) => n.id === id),
  upsert: (note: NoteRow) => {
    const rows = readJson<NoteRow>(NOTES_FILE);
    const idx = rows.findIndex((n) => n.id === note.id);
    if (idx >= 0) rows[idx] = note;
    else rows.push(note);
    writeJson(NOTES_FILE, rows);
  },
};

export type { UserRow, NoteRow };
