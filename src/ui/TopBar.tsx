import { EditorView } from "@codemirror/view";
import { cancelGeneration, dismissError, useGenStatus } from "../gen/engine";
import { useSettings } from "../state/settings";

interface TopBarProps {
  viewRef: React.RefObject<EditorView | null>;
  onToggleSettings: () => void;
  sessionSlot?: React.ReactNode;
}

export default function TopBar({ onToggleSettings, sessionSlot }: TopBarProps) {
  const status = useGenStatus();
  const settings = useSettings();

  return (
    <header className="topbar">
      <span className="brand">misapad</span>
      {sessionSlot}
      <span className="spacer" />
      {status.state === "generating" && (
        <>
          <span className="status generating">generating…</span>
          <button onClick={() => cancelGeneration()}>Stop (Esc)</button>
        </>
      )}
      {status.state === "error" && (
        <span className="status error" onClick={dismissError} title="Click to dismiss">
          ⚠ {status.message}
        </span>
      )}
      <span className="model" title={settings.baseUrl}>
        {settings.model || "no model set"} · {settings.mode}
      </span>
      <button onClick={onToggleSettings} title="Settings">
        ⚙
      </button>
    </header>
  );
}
