import {
  createSession,
  deleteSession,
  renameSession,
  switchSession,
  useSessions,
} from "../state/sessions";

interface SessionPickerProps {
  /** Called after the current session changes so the editor can swap docs. */
  onSessionChange: () => void;
}

export default function SessionPicker({ onSessionChange }: SessionPickerProps) {
  const sessions = useSessions();

  const change = (fn: () => void) => {
    fn();
    onSessionChange();
  };

  return (
    <span className="session-picker">
      <select value={sessions.currentId} onChange={(e) => change(() => switchSession(e.target.value))}>
        {Object.entries(sessions.list).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <button
        title="New session"
        onClick={() => {
          const name = window.prompt("Session name", "untitled");
          if (name !== null) change(() => createSession(name));
        }}
      >
        +
      </button>
      <button
        title="Rename session"
        onClick={() => {
          const name = window.prompt("Rename session", sessions.list[sessions.currentId]);
          if (name) renameSession(sessions.currentId, name);
        }}
      >
        ✎
      </button>
      <button
        title="Delete session"
        onClick={() => {
          if (window.confirm(`Delete session "${sessions.list[sessions.currentId]}"?`)) {
            change(() => deleteSession(sessions.currentId));
          }
        }}
      >
        🗑
      </button>
    </span>
  );
}
