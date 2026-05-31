import { useEffect } from "react";
import TopBar from "@/components/TopBar";
import NoteList from "@/components/NoteList";
import NoteEditor from "@/components/NoteEditor";
import { useNotesStore } from "@/store/notes";
import { syncEngine } from "@/sync/engine";

export default function HomePage() {
  const ready = useNotesStore((s) => s.ready);
  const init = useNotesStore((s) => s.init);
  const user = useNotesStore((s) => s.user);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!ready) return;
    syncEngine.init();
    if (user) {
      syncEngine.triggerCloudSync();
    }
    return () => syncEngine.destroy();
  }, [ready, user]);

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 skeleton rounded-2xl mx-auto mb-4" />
          <div className="w-40 h-4 skeleton rounded mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0">
        <NoteList />
        <NoteEditor />
      </div>
    </div>
  );
}
