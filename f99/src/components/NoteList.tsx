import { useNotesStore } from "@/store/notes";
import { Plus, Search, FileText, Trash2 } from "lucide-react";
import { useMemo } from "react";

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return text;
  const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((p, i) =>
    pattern.test(p) ? <mark key={i} className="hl">{p}</mark> : <span key={i}>{p}</span>
  );
}

export default function NoteList() {
  const notes = useNotesStore((s) => s.notes);
  const activeId = useNotesStore((s) => s.activeId);
  const query = useNotesStore((s) => s.query);
  const setQuery = useNotesStore((s) => s.setQuery);
  const setActive = useNotesStore((s) => s.setActive);
  const createNote = useNotesStore((s) => s.createNote);
  const deleteActive = useNotesStore((s) => s.deleteActive);

  const sorted = useMemo(
    () => [...notes].sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1)),
    [notes]
  );

  const handleCreate = async () => {
    const note = await createNote();
    setActive(note.id);
  };

  return (
    <div className="h-full flex flex-col bg-white/70 backdrop-blur border-r border-ink-100">
      <div className="p-4 border-b border-ink-100 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-display text-xl font-bold text-ink-700">Notes</div>
          <button onClick={handleCreate} className="btn btn-primary !py-1.5 !px-3 text-xs">
            <Plus size={14} /> New
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search (FTS5)..."
            className="w-full pl-9 pr-3 py-2 rounded-full border border-ink-100 bg-white text-sm placeholder:text-ink-200 focus:border-moss-500 focus:shadow-soft transition"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {sorted.length === 0 && (
          <div className="p-6 text-center text-ink-500 text-sm">
            <FileText className="mx-auto mb-2 opacity-40" size={28} />
            No notes yet.
          </div>
        )}
        {sorted.map((n) => (
          <div
            key={n.id}
            onClick={() => setActive(n.id)}
            className={`group px-4 py-3 mx-2 rounded-xl cursor-pointer transition-all mb-1 ${
              activeId === n.id
                ? "bg-moss-500 text-white shadow-soft"
                : "hover:bg-ink-50 text-ink-700"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className={`font-display font-semibold text-[15px] truncate ${activeId === n.id ? "text-white" : "text-ink-700"}`}>
                  {n.title ? highlight(n.title, query) : <span className="italic opacity-60">Untitled</span>}
                </div>
                <div className={`text-xs mt-1 opacity-70 line-clamp-2 ${activeId === n.id ? "text-white/85" : "text-ink-500"}`}>
                  {n.content.slice(0, 120) || "Empty note"}
                </div>
                <div className={`text-[10px] mt-1.5 font-mono ${activeId === n.id ? "text-white/70" : "text-ink-200"}`}>
                  {new Date(n.updated_at).toLocaleString()}
                  {n.dirty ? " • modified" : ""}
                </div>
              </div>
              {activeId === n.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteActive(); }}
                  className="opacity-80 hover:opacity-100 text-white/80 hover:text-white p-1"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
