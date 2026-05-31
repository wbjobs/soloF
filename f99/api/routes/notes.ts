import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";
import { notesRepo, type NoteRow } from "../db/store.js";
import { verifyToken } from "./auth.js";
import type { SyncRequest } from "../../shared/types.js";

const router = Router();

function extractUser(req: Request): { id: string; email: string } | null {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return verifyToken(token);
}

function requireAuth(req: Request, res: Response): { id: string; email: string } | null {
  const user = extractUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

// POST /api/sync  - bidirectional sync
router.post("/sync", async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const body = (req.body || {}) as SyncRequest;
  const { last_sync_at, changes = [] } = body;
  const serverTime = new Date().toISOString();
  const accepted: string[] = [];

  for (const remote of changes) {
    if (!remote || !remote.id) continue;
    // Only accept rows that belong to the user
    const existing = notesRepo.findById(remote.id);
    const ownerId = existing?.user_id || user.id;
    if (ownerId !== user.id) continue;

    // LWW: if existing exists and its server_updated_at > remote.server_updated_at (or remote's is missing), skip
    if (existing && remote.server_updated_at && existing.server_updated_at > remote.server_updated_at) {
      // Server version is newer — client will receive it via remote_changes
      continue;
    }

    const row: NoteRow = {
      id: remote.id,
      user_id: ownerId,
      title: remote.title ?? "",
      content: remote.content ?? "",
      created_at: remote.created_at || new Date().toISOString(),
      updated_at: remote.updated_at || new Date().toISOString(),
      server_updated_at: serverTime,
      deleted: !!remote.deleted,
    };
    notesRepo.upsert(row);
    accepted.push(remote.id);
  }

  // Return remote changes newer than last_sync_at (default all)
  const remoteChanges = notesRepo.listChangedAfter(user.id, last_sync_at);

  res.status(200).json({
    server_time: serverTime,
    remote_changes: remoteChanges,
    accepted_ids: accepted,
  });
});

// GET /api/notes
router.get("/notes", async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const notes = notesRepo.listForUser(user.id);
  res.status(200).json(notes);
});

// POST /api/notes
router.post("/notes", async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const body = req.body || {};
  const now = new Date().toISOString();
  const row: NoteRow = {
    id: body.id || uuid(),
    user_id: user.id,
    title: body.title || "",
    content: body.content || "",
    created_at: body.created_at || now,
    updated_at: now,
    server_updated_at: now,
    deleted: false,
  };
  notesRepo.upsert(row);
  res.status(201).json(row);
});

// PATCH /api/notes/:id
router.patch("/notes/:id", async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const id = req.params.id;
  const existing = notesRepo.findById(id);
  if (!existing || existing.user_id !== user.id) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const now = new Date().toISOString();
  const merged: NoteRow = {
    ...existing,
    ...req.body,
    id,
    user_id: user.id,
    updated_at: now,
    server_updated_at: now,
  };
  notesRepo.upsert(merged);
  res.status(200).json(merged);
});

// DELETE /api/notes/:id
router.delete("/notes/:id", async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const id = req.params.id;
  const existing = notesRepo.findById(id);
  if (!existing || existing.user_id !== user.id) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const now = new Date().toISOString();
  notesRepo.upsert({ ...existing, deleted: true, updated_at: now, server_updated_at: now });
  res.status(200).json({ success: true });
});

export default router;
