import { createStore } from "./store";

export interface SessionsIndex {
  currentId: string;
  /** id → display name */
  list: Record<string, string>;
}

const INDEX_KEY = "misapad.sessions";
const docKey = (id: string) => `misapad.doc.${id}`;

const storage = typeof localStorage !== "undefined" ? localStorage : null;

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadIndex(): SessionsIndex {
  try {
    const raw = storage?.getItem(INDEX_KEY);
    if (raw) {
      const idx = JSON.parse(raw) as SessionsIndex;
      if (idx.currentId && idx.list[idx.currentId]) return idx;
    }
  } catch {
    // fall through to a fresh index
  }
  const id = newId();
  const fresh: SessionsIndex = { currentId: id, list: { [id]: "untitled" } };
  try {
    // Persist immediately so a reload finds the same session id (autosaved
    // docs are keyed by it).
    storage?.setItem(INDEX_KEY, JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

const store = createStore<SessionsIndex>(loadIndex());
export const useSessions = () => store.use();
export const getSessions = () => store.get();

function setIndex(next: SessionsIndex) {
  store.set(next);
  try {
    storage?.setItem(INDEX_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function loadDoc(id: string): string {
  return storage?.getItem(docKey(id)) ?? "";
}

function saveDoc(id: string, text: string) {
  try {
    storage?.setItem(docKey(id), text);
  } catch {
    // ignore quota errors
  }
}

// --- debounced autosave -----------------------------------------------------
// The pending save captures a text getter, so the flush always writes the
// latest doc and always under the session that scheduled it.

let pending: { timer: ReturnType<typeof setTimeout>; id: string; getText: () => string } | null = null;

export function scheduleAutosave(getText: () => string) {
  if (pending) clearTimeout(pending.timer);
  const id = store.get().currentId;
  pending = { id, getText, timer: setTimeout(flushAutosave, 500) };
}

export function flushAutosave() {
  if (!pending) return;
  clearTimeout(pending.timer);
  saveDoc(pending.id, pending.getText());
  pending = null;
}

// --- session CRUD -----------------------------------------------------------

export function switchSession(id: string) {
  flushAutosave();
  const idx = store.get();
  if (!idx.list[id]) return;
  setIndex({ ...idx, currentId: id });
}

export function createSession(name: string): string {
  flushAutosave();
  const idx = store.get();
  const id = newId();
  setIndex({ currentId: id, list: { ...idx.list, [id]: name || "untitled" } });
  return id;
}

export function renameSession(id: string, name: string) {
  const idx = store.get();
  if (!idx.list[id] || !name) return;
  setIndex({ ...idx, list: { ...idx.list, [id]: name } });
}

export function deleteSession(id: string) {
  const idx = store.get();
  if (!idx.list[id]) return;
  if (pending?.id === id) {
    clearTimeout(pending.timer);
    pending = null;
  }
  try {
    storage?.removeItem(docKey(id));
  } catch {
    // ignore
  }
  const list = { ...idx.list };
  delete list[id];
  let currentId = idx.currentId;
  if (currentId === id) {
    currentId = Object.keys(list)[0] ?? newId();
    if (!list[currentId]) list[currentId] = "untitled";
  }
  setIndex({ currentId, list });
}
