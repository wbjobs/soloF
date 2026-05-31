import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useNotesStore } from '@/store/notes';
import { getDb } from '@/db';
import type { Note } from '@/types';

const COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#A855F7',
  '#EC4899', '#F43F5E',
];

function getColorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor?: {
    position: number;
    selection: { from: number; to: number } | null;
  };
}

interface CollabSession {
  noteId: string;
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  unsubscribe: () => void;
}

let currentSession: CollabSession | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveToLocalDb(noteId: string, ytext: Y.Text) {
  const db = await getDb();
  const content = ytext.toString();
  const firstLine = content.split('\n')[0] || 'Untitled';
  const title = firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
  
  const existing = await db.getNote(noteId);
  if (existing) {
    await db.updateNote(noteId, { title, content }, true);
  } else {
    const user = useNotesStore.getState().user;
    await db.createNote({
      id: noteId,
      title,
      content,
      user_id: user?.id ?? null,
    });
  }
  await useNotesStore.getState().loadNotes();
}

export function startCollabSession(noteId: string, initialContent?: string): {
  ytext: Y.Text;
  getCollaborators: () => Collaborator[];
  onCollaboratorsChange: (cb: (collabs: Collaborator[]) => void) => () => void;
  updateCursor: (position: number, selection: { from: number; to: number } | null) => void;
  dispose: () => void;
} {
  if (currentSession) {
    if (currentSession.noteId === noteId) {
      return createSessionApi(currentSession);
    }
    disposeCurrentSession();
  }

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');

  if (initialContent && ytext.length === 0) {
    ytext.insert(0, initialContent);
  }

  const user = useNotesStore.getState().user;
  const userId = user?.id || 'anon-' + Math.random().toString(36).slice(2, 8);
  const userName = user?.email?.split('@')[0] || 'Anonymous';
  const userColor = getColorForUserId(userId);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/collab?room=${encodeURIComponent(noteId)}&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(userName)}`;
  
  const provider = new WebsocketProvider(
    wsUrl,
    noteId,
    ydoc,
    { connect: true, params: { userId, name: userName } }
  );

  provider.awareness.setLocalStateField('user', {
    id: userId,
    name: userName,
    color: userColor,
  });

  const observer = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveToLocalDb(noteId, ytext);
    }, 1000);
  };
  ytext.observe(observer);

  currentSession = {
    noteId,
    ydoc,
    ytext,
    provider,
    unsubscribe: () => {
      ytext.unobserve(observer);
    },
  };

  return createSessionApi(currentSession);
}

function createSessionApi(session: CollabSession) {
  const { ydoc, ytext, provider, unsubscribe } = session;
  const user = useNotesStore.getState().user;
  const userId = user?.id || 'anon';

  return {
    ytext,
    getCollaborators: (): Collaborator[] => {
      const collabs: Collaborator[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (state.user && state.user.id !== userId) {
          collabs.push({
            id: state.user.id,
            name: state.user.name,
            color: state.user.color,
            cursor: state.cursor,
          });
        }
      });
      return collabs;
    },
    onCollaboratorsChange: (cb: (collabs: Collaborator[]) => void): (() => void) => {
      const handler = () => {
        const collabs: Collaborator[] = [];
        provider.awareness.getStates().forEach((state, clientId) => {
          if (state.user && state.user.id !== userId) {
            collabs.push({
              id: state.user.id,
              name: state.user.name,
              color: state.user.color,
              cursor: state.cursor,
            });
          }
        });
        cb(collabs);
      };
      provider.awareness.on('change', handler);
      return () => provider.awareness.off('change', handler);
    },
    updateCursor: (position: number, selection: { from: number; to: number } | null) => {
      provider.awareness.setLocalStateField('cursor', {
        position,
        selection,
      });
    },
    dispose: () => {
      unsubscribe();
      if (saveTimer) clearTimeout(saveTimer);
      saveToLocalDb(session.noteId, ytext);
      provider.destroy();
      ydoc.destroy();
      if (currentSession?.noteId === session.noteId) {
        currentSession = null;
      }
    },
  };
}

export function disposeCurrentSession() {
  if (currentSession) {
    currentSession.unsubscribe();
    currentSession.provider.destroy();
    currentSession.ydoc.destroy();
    currentSession = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function getCurrentSession(): CollabSession | null {
  return currentSession;
}
