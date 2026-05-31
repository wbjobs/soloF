import { useState, useRef } from "react";
import { Download, Upload, Trash2, RefreshCw, ArrowLeft, Database, Cloud } from "lucide-react";
import { Link } from "react-router-dom";
import { getDb } from "@/db";
import { syncEngine } from "@/sync/engine";
import { useNotesStore } from "@/store/notes";

export default function SettingsPage() {
  const user = useNotesStore((s) => s.user);
  const syncStatus = useNotesStore((s) => s.syncStatus);
  const lastSyncAt = useNotesStore((s) => s.lastSyncAt);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showMessage = (msg: string, type: "success" | "error" = "success") => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleExport = async () => {
    try {
      const db = await getDb();
      const data = await db.exportDb();
      const blob = new Blob([data], { type: "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = db.getDbFilename();
      a.click();
      URL.revokeObjectURL(url);
      showMessage("Database exported successfully");
    } catch (e) {
      showMessage(`Export failed: ${(e as Error).message}`, "error");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const db = await getDb();
      await db.importDb(buffer);
      await loadNotes();
      showMessage("Database imported successfully");
    } catch (e) {
      showMessage(`Import failed: ${(e as Error).message}`, "error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    if (!confirm("Are you sure you want to delete all local notes? This cannot be undone.")) return;
    try {
      const db = await getDb();
      await db.clearAll();
      await loadNotes();
      showMessage("All notes cleared");
    } catch (e) {
      showMessage(`Clear failed: ${(e as Error).message}`, "error");
    }
  };

  const handleSync = async () => {
    if (!user) {
      showMessage("Please sign in to sync", "error");
      return;
    }
    setSyncing(true);
    try {
      await syncEngine.triggerCloudSync();
      showMessage("Cloud sync completed");
    } catch (e) {
      showMessage(`Sync failed: ${(e as Error).message}`, "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-ink-100">
        <Link to="/" className="btn-ghost -ml-2">
          <ArrowLeft size={18} /> Back
        </Link>
        <h1 className="font-display text-xl font-bold text-ink-700">Settings</h1>
        <div className="w-20" />
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6">
        {message && (
          <div className={`p-4 rounded-xl ${
            messageType === "success" 
              ? "bg-moss-50 text-moss-700 border border-moss-100" 
              : "bg-red-50 text-red-700 border border-red-100"
          }`}>
            {message}
          </div>
        )}

        {/* Real-time Collaboration */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-moss-50 text-moss-600 flex items-center justify-center">
              <Cloud size={20} />
            </div>
            <div>
              <h2 className="font-display font-semibold text-ink-700">Real-time Collaboration</h2>
              <p className="text-xs text-ink-500">
                {user 
                  ? `Signed in as ${user.email} · Yjs CRDT sync active` 
                  : "Not signed in · Offline mode only"}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Primary sync</span>
              <span className="font-mono text-xs text-moss-600">
                WebSocket + Yjs CRDT
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Fallback sync</span>
              <span className="font-mono text-xs text-ink-500">
                Cloud API (5 min interval)
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Cloud status</span>
              <span className={`font-mono text-xs ${
                syncStatus === "idle" ? "text-moss-600" :
                syncStatus === "syncing" ? "text-amber2-500" :
                syncStatus === "error" ? "text-red-500" : "text-ink-400"
              }`}>
                {syncStatus}
              </span>
            </div>
            {lastSyncAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Last cloud sync</span>
                <span className="font-mono text-xs text-ink-500">
                  {new Date(lastSyncAt).toLocaleString()}
                </span>
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || !user}
              className="btn btn-primary w-full mt-2"
            >
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing..." : "Force cloud sync"}
            </button>
          </div>
        </div>

        {/* Database Section */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-ink-50 text-ink-600 flex items-center justify-center">
              <Database size={20} />
            </div>
            <div>
              <h2 className="font-display font-semibold text-ink-700">Database</h2>
              <p className="text-xs text-ink-500">SQLite Wasm · IndexedDB storage</p>
            </div>
          </div>
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".db,.sqlite,.sqlite3"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary w-full"
            >
              <Upload size={16} /> Import database
            </button>
            <button
              onClick={handleExport}
              className="btn btn-secondary w-full"
            >
              <Download size={16} /> Export database
            </button>
            <button
              onClick={handleClear}
              className="btn w-full border border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={16} /> Clear all notes
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="text-center text-xs text-ink-400">
          <p>Folio Notes · SQLite Wasm + React + Express</p>
          <p className="mt-1">Data is stored locally in your browser</p>
        </div>
      </main>
    </div>
  );
}
