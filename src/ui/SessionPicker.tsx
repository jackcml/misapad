import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
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

type SessionDialog = "create" | "rename" | "delete" | null;

export default function SessionPicker({ onSessionChange }: SessionPickerProps) {
  const sessions = useSessions();
  const [dialog, setDialog] = useState<SessionDialog>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const currentName = sessions.list[sessions.currentId];

  const change = (fn: () => void) => {
    fn();
    onSessionChange();
  };

  const finish = (name?: string) => {
    if (dialog === "create" && name) change(() => createSession(name));
    else if (dialog === "rename" && name) {
      renameSession(sessions.currentId, name);
      dialogTrigger.current?.focus();
    } else if (dialog === "delete") change(() => deleteSession(sessions.currentId));
    setDialog(null);
  };

  const openDialog = (kind: Exclude<SessionDialog, null>, trigger: HTMLButtonElement) => {
    dialogTrigger.current = trigger;
    setDialog(kind);
  };

  const cancelDialog = () => {
    setDialog(null);
    dialogTrigger.current?.focus();
  };

  return (
    <>
      <span className="session-picker">
        <select
          aria-label="Current session"
          value={sessions.currentId}
          onChange={(e) => change(() => switchSession(e.target.value))}
        >
          {Object.entries(sessions.list).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button
          title="New session"
          aria-label="New session"
          onClick={(event) => openDialog("create", event.currentTarget)}
        >
          +
        </button>
        <button
          title="Rename session"
          aria-label="Rename session"
          onClick={(event) => openDialog("rename", event.currentTarget)}
        >
          ✎
        </button>
        <button
          title="Delete session"
          aria-label="Delete session"
          onClick={(event) => openDialog("delete", event.currentTarget)}
        >
          🗑
        </button>
      </span>
      {dialog && (
        <SessionDialogBox
          kind={dialog}
          currentName={currentName}
          onCancel={cancelDialog}
          onFinish={finish}
        />
      )}
    </>
  );
}

interface SessionDialogBoxProps {
  kind: Exclude<SessionDialog, null>;
  currentName: string;
  onCancel: () => void;
  onFinish: (name?: string) => void;
}

function SessionDialogBox({ kind, currentName, onCancel, onFinish }: SessionDialogBoxProps) {
  const [name, setName] = useState(kind === "create" ? "untitled" : currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cleanName = name.trim();

  useEffect(() => {
    if (kind === "delete") deleteRef.current?.focus();
    else inputRef.current?.select();
  }, [kind]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === "delete") onFinish();
    else if (cleanName) onFinish(cleanName);
  };

  const handleKeys = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)"),
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const title =
    kind === "create" ? "New session" : kind === "rename" ? "Rename session" : "Delete session?";

  return createPortal(
    <div
      className="session-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
        aria-describedby={kind === "delete" ? "session-delete-description" : undefined}
        onSubmit={submit}
        onKeyDown={handleKeys}
      >
        <h2 id="session-dialog-title">{title}</h2>
        {kind === "delete" ? (
          <p id="session-delete-description">
            <strong>{currentName}</strong> and its contents will be permanently deleted.
          </p>
        ) : (
          <label>
            Name
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        <div className="session-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={deleteRef}
            type="submit"
            className={kind === "delete" ? "danger" : "primary"}
            disabled={kind !== "delete" && !cleanName}
          >
            {kind === "create" ? "Create" : kind === "rename" ? "Save" : "Delete"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
