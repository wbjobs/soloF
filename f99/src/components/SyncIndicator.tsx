import { useNotesStore } from "@/store/notes";
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { syncEngine } from "@/sync/engine";

export default function SyncIndicator() {
  const status = useNotesStore((s) => s.syncStatus);
  const lastSync = useNotesStore((s) => s.lastSyncAt);
  const user = useNotesStore((s) => s.user);

  const label =
    status === "syncing" ? "Syncing..." :
    status === "error" ? "Sync error" :
    status === "idle" ? "Synced" :
    user ? "Online" : "Offline mode";

  const Icon =
    status === "syncing" ? RefreshCw :
    status === "error" ? AlertTriangle :
    status === "idle" && user ? Cloud : CloudOff;

  return (
    <button
      onClick={() => syncEngine.triggerCloudSync()}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-ink-100 bg-white hover:border-moss-500 hover:text-moss-600 text-xs text-ink-500 transition"
      title={lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : "Click to sync"}
    >
      <span className={`sync-dot ${status}`} />
      <Icon size={14} className={status === "syncing" ? "animate-spin" : ""} />
      <span>{label}</span>
    </button>
  );
}
