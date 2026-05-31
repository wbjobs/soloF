export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string | null;
  dirty: number;
  deleted: number;
  user_id: string | null;
}

export interface User {
  id: string;
  email: string;
}

export interface SyncRequest {
  last_sync_at: string | null;
  changes: Note[];
}

export interface SyncResponse {
  server_time: string;
  remote_changes: Note[];
  accepted_ids: string[];
}

export type SyncStatus = "idle" | "syncing" | "error" | "offline";
