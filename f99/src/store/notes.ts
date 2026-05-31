import { create } from "zustand";
import type { Note, SyncStatus, User } from "@/types";
import { getDb } from "@/db";

interface NotesState {
  ready: boolean;
  notes: Note[];
  activeId: string | null;
  query: string;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  user: User | null;
  error: string | null;

  init: () => Promise<void>;
  setActive: (id: string | null) => void;
  setQuery: (q: string) => void;
  setUser: (u: User | null) => void;
  setSyncStatus: (s: SyncStatus) => void;
  setLastSyncAt: (t: string | null) => void;
  setError: (e: string | null) => void;

  createNote: () => Promise<Note>;
  updateActive: (patch: Partial<Note>) => Promise<void>;
  deleteActive: () => Promise<void>;
  loadNotes: () => Promise<Note[]>;
  search: (q: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  ready: false,
  notes: [],
  activeId: null,
  query: "",
  syncStatus: "offline",
  lastSyncAt: null,
  user: null,
  error: null,

  init: async () => {
    try {
      await getDb();
      const notes = await get().loadNotes();
      const raw = localStorage.getItem("f99-user");
      const user = raw ? (JSON.parse(raw) as User) : null;
      const lastSync = localStorage.getItem("f99-last-sync");
      set({ ready: true, user, lastSyncAt: lastSync, notes });
    } catch (e) {
      console.error(e);
      set({ ready: true, error: (e as Error).message });
    }
  },

  setActive: (id) => set({ activeId: id }),
  setQuery: (q) => {
    set({ query: q });
    get().search(q);
  },
  setUser: (u) => {
    if (u) localStorage.setItem("f99-user", JSON.stringify(u));
    else localStorage.removeItem("f99-user");
    set({ user: u });
  },
  setSyncStatus: (s) => set({ syncStatus: s }),
  setLastSyncAt: (t) => {
    if (t) localStorage.setItem("f99-last-sync", t);
    set({ lastSyncAt: t });
  },
  setError: (e) => set({ error: e }),

  loadNotes: async () => {
    const db = await getDb();
    const notes = await db.listNotes();
    set({ notes });
    return notes;
  },

  search: async (q) => {
    const db = await getDb();
    const notes = q.trim() ? await db.searchNotes(q) : await db.listNotes();
    set({ notes, query: q });
  },

  createNote: async () => {
    const db = await getDb();
    const user = get().user;
    const note = await db.createNote({
      title: "Untitled",
      content: "# Untitled\n\nStart writing your note here...",
      user_id: user?.id ?? null,
    });
    set((s) => ({ notes: [note, ...s.notes], activeId: note.id }));
    return note;
  },

  updateActive: async (patch) => {
    const id = get().activeId;
    if (!id) return;
    const db = await getDb();
    const updated = await db.updateNote(id, patch, true);
    if (updated) {
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? updated : n)),
      }));
    }
  },

  deleteActive: async () => {
    const id = get().activeId;
    if (!id) return;
    const db = await getDb();
    await db.deleteNote(id, true);
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      activeId: null,
    }));
  },
}));
