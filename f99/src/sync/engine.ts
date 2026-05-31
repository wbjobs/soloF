import { getDb } from "@/db";
import { useNotesStore } from "@/store/notes";
import type { Note, SyncRequest, SyncResponse } from "@/types";

const API_BASE = "/api";
const CLOUD_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes (cloud sync as fallback)

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("f99-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || "Login failed");
  }
  const data = await res.json();
  localStorage.setItem("f99-token", data.token);
  localStorage.setItem("f99-user", JSON.stringify(data.user));
  return data as { token: string; user: { id: string; email: string } };
}

export async function register(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || "Register failed");
  }
  const data = await res.json();
  localStorage.setItem("f99-token", data.token);
  localStorage.setItem("f99-user", JSON.stringify(data.user));
  return data as { token: string; user: { id: string; email: string } };
}

export function logout() {
  localStorage.removeItem("f99-token");
  localStorage.removeItem("f99-user");
}

class SyncEngine {
  private cloudTimer: ReturnType<typeof setInterval> | null = null;
  private online: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
  private runningCloudSync = false;

  init() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => {
      this.online = true;
      this.triggerCloudSync();
    });
    window.addEventListener("offline", () => {
      this.online = false;
      useNotesStore.getState().setSyncStatus("offline");
    });
    this.cloudTimer = setInterval(() => {
      if (this.online && useNotesStore.getState().user) {
        this.triggerCloudSync();
      }
    }, CLOUD_SYNC_INTERVAL);
  }

  destroy() {
    if (this.cloudTimer) clearInterval(this.cloudTimer);
    this.cloudTimer = null;
  }

  isOnline() {
    return this.online;
  }

  private pendingCloudSync: Promise<void> | null = null;
  triggerCloudSync() {
    if (!this.pendingCloudSync) {
      this.pendingCloudSync = this.performCloudSync().finally(() => {
        this.pendingCloudSync = null;
      });
    }
    return this.pendingCloudSync;
  }

  private async performCloudSync() {
    if (this.runningCloudSync) return;
    const store = useNotesStore.getState();
    if (!store.user) return;
    if (!this.online) {
      store.setSyncStatus("offline");
      return;
    }
    this.runningCloudSync = true;
    store.setSyncStatus("syncing");
    try {
      const db = await getDb();
      const dirty = await db.getDirtyNotes();
      const lastSync = store.lastSyncAt;
      const body: SyncRequest = { last_sync_at: lastSync, changes: dirty };
      const res = await fetch(`${API_BASE}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        store.setUser(null);
        logout();
        store.setSyncStatus("offline");
        return;
      }
      if (!res.ok) {
        throw new Error(`Sync failed: ${res.status}`);
      }
      const data: SyncResponse = await res.json();
      for (const remote of data.remote_changes) {
        await db.applyRemoteNote(remote as Note);
      }
      for (const id of data.accepted_ids) {
        await db.clearDirty(id, data.server_time);
      }
      store.setLastSyncAt(data.server_time);
      await store.loadNotes();
      store.setSyncStatus("idle");
    } catch (e) {
      console.error("[sync]", e);
      store.setSyncStatus("error");
      store.setError((e as Error).message);
    } finally {
      this.runningCloudSync = false;
    }
  }
}

export const syncEngine = new SyncEngine();
