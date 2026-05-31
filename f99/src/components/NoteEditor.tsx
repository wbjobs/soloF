import { useEffect, useRef, useState, useCallback } from "react";
import { useNotesStore } from "@/store/notes";
import MarkdownPreview from "./MarkdownPreview";
import { Trash2, Eye, Code2, Wifi, WifiOff } from "lucide-react";
import { startCollabSession, type Collaborator } from "@/collab";
import type { Note } from "@/types";
import * as Y from 'yjs';

export default function NoteEditor() {
  const activeId = useNotesStore((s) => s.activeId);
  const notes = useNotesStore((s) => s.notes);
  const user = useNotesStore((s) => s.user);
  const deleteActive = useNotesStore((s) => s.deleteActive);
  const updateActive = useNotesStore((s) => s.updateActive);

  const active: Note | null = notes.find((n) => n.id === activeId) || null;
  const [showPreview, setShowPreview] = useState(true);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const collabDisposeRef = useRef<(() => void) | null>(null);
  const localContentRef = useRef<string>("");
  const cursorUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [draftTitle, setDraftTitle] = useState(active?.title ?? "");
  const [draftContent, setDraftContent] = useState(active?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCollaboratorCursor = useCallback((position: number) => {
    if (cursorUpdateRef.current) clearTimeout(cursorUpdateRef.current);
    cursorUpdateRef.current = setTimeout(() => {
      // Cursor awareness updates handled by y-websocket awareness
    }, 100);
  }, []);

  useEffect(() => {
    setDraftTitle(active?.title ?? "");
    setDraftContent(active?.content ?? "");
    localContentRef.current = active?.content ?? "";
    setDirty(false);

    if (user && activeId) {
      if (collabDisposeRef.current) {
        collabDisposeRef.current();
      }
      const session = startCollabSession(activeId, active?.content || "");
      ytextRef.current = session.ytext;
      collabDisposeRef.current = () => session.dispose();
      localContentRef.current = session.ytext.toString();

      const unsubCollabs = session.onCollaboratorsChange((collabs) => {
        setCollaborators(collabs);
      });

      const yObserver = () => {
        if (ytextRef.current) {
          const newVal = ytextRef.current.toString();
          if (textareaRef.current && textareaRef.current.value !== newVal) {
            const cursorPos = textareaRef.current.selectionStart;
            textareaRef.current.value = newVal;
            textareaRef.current.setSelectionRange(cursorPos, cursorPos);
            localContentRef.current = newVal;
          }
        }
      };
      ytextRef.current.observe(yObserver);

      return () => {
        ytextRef.current?.unobserve(yObserver);
        unsubCollabs();
        session.dispose();
        ytextRef.current = null;
        collabDisposeRef.current = null;
        setCollaborators([]);
      };
    } else {
      if (collabDisposeRef.current) {
        collabDisposeRef.current();
        collabDisposeRef.current = null;
      }
      ytextRef.current = null;
      setCollaborators([]);
    }
  }, [activeId, user]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    localContentRef.current = newValue;

    if (ytextRef.current && user) {
      const ytext = ytextRef.current;
      const oldValue = ytext.toString();
      if (newValue === oldValue) return;

      let start = 0;
      const maxLen = Math.min(oldValue.length, newValue.length);
      while (start < maxLen && oldValue[start] === newValue[start]) {
        start++;
      }

      const oldEnd = oldValue.length;
      const newEnd = newValue.length;
      const deleteLen = oldEnd - start;
      const insertStr = newValue.slice(start, newEnd - (oldEnd - start));

      if (deleteLen > 0) {
        ytext.delete(start, deleteLen);
      }
      if (insertStr) {
        ytext.insert(start, insertStr);
      }
    } else {
      setDraftContent(newValue);
      setDirty(true);
    }
  };

  const handleSelectionChange = () => {
    if (textareaRef.current && user) {
      updateCollaboratorCursor(textareaRef.current.selectionStart);
    }
  };

  useEffect(() => {
    if (!activeId || user) return;
    if (!dirty && draftTitle === active?.title) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateActive({ title: draftTitle, content: draftContent });
      setDirty(false);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draftTitle, draftContent, activeId, dirty, user]);

  if (!active) {
    return (
      <div className="h-full flex items-center justify-center text-ink-500 select-none">
        <div className="text-center">
          <div className="font-display text-3xl text-moss-600 mb-3">No note selected</div>
          <div className="text-sm opacity-80">Create a new note or pick one from the list.</div>
          {!user && (
            <div className="mt-4 text-sm text-amber2-500">
              <WifiOff size={14} className="inline mr-1" />
              Sign in to enable real-time collaboration
            </div>
          )}
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm("Delete this note? This can be undone until next sync.")) return;
    if (collabDisposeRef.current) {
      collabDisposeRef.current();
      collabDisposeRef.current = null;
    }
    await deleteActive();
  };

  const displayContent = user ? (ytextRef.current?.toString() || localContentRef.current) : draftContent;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-6 py-3 border-b border-ink-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            value={draftTitle}
            onChange={(e) => { setDraftTitle(e.target.value); setDirty(true); }}
            placeholder="Untitled"
            className="font-display text-2xl font-semibold bg-transparent outline-none w-full text-ink-700 placeholder:text-ink-200"
          />
          {(dirty || (user && ytextRef.current)) && (
            <span className="text-xs text-amber2-500 font-mono whitespace-nowrap">
              {user ? "Live" : "Saving…"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {user && (
            <div className="flex items-center gap-1 mr-2 px-2 py-1 rounded-full bg-ink-50">
              <Wifi size={12} className="text-moss-500" />
              {collaborators.length > 0 && (
                <div className="flex items-center gap-0.5">
                  {collaborators.slice(0, 3).map((c) => (
                    <div
                      key={c.id}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold relative"
                      style={{ backgroundColor: c.color }}
                      title={c.name}
                    >
                      {c.name[0].toUpperCase()}
                      {c.cursor && (
                        <span 
                          className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full border-2 border-white"
                          style={{ backgroundColor: c.color }}
                        />
                      )}
                    </div>
                  ))}
                  {collaborators.length > 3 && (
                    <span className="text-xs text-ink-500 ml-1">+{collaborators.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            className="btn-ghost"
            onClick={() => setShowPreview((v) => !v)}
            title={showPreview ? "Edit only" : "Split view"}
          >
            {showPreview ? <Code2 size={16} /> : <Eye size={16} />}
          </button>
          <button className="btn-ghost text-red-500 hover:text-red-600" onClick={handleDelete} title="Delete note">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0">
        <div 
          ref={editorWrapperRef}
          className="border-r border-ink-100 overflow-hidden relative"
        >
          <textarea
            ref={textareaRef}
            className="editor-textarea relative z-10"
            defaultValue={user ? (active?.content || "") : undefined}
            value={user ? undefined : draftContent}
            onChange={handleContentChange}
            onSelect={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            onClick={handleSelectionChange}
            placeholder="# Start writing in Markdown..."
            spellCheck={false}
          />
          {collaborators.length > 0 && (
            <div className="absolute top-2 right-2 flex flex-col gap-1 z-20 pointer-events-none">
              {collaborators.map((c) => (
                c.cursor && (
                  <div
                    key={c.id}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-white shadow-soft"
                    style={{ backgroundColor: c.color }}
                  >
                    <span className="font-medium">{c.name}</span>
                    {c.cursor.selection && c.cursor.selection.from !== c.cursor.selection.to && (
                      <span className="opacity-80">
                        ({Math.abs(c.cursor.selection.to - c.cursor.selection.from)} selected)
                      </span>
                    )}
                  </div>
                )
              ))}
            </div>
          )}
        </div>
        {showPreview && (
          <div className="bg-ink-50/40 overflow-hidden">
            <MarkdownPreview content={displayContent} />
          </div>
        )}
      </div>
    </div>
  );
}
