import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import Editor from "./editor/Editor";
import { baseExtensions } from "./editor/setup";
import TopBar from "./ui/TopBar";
import SettingsPanel from "./ui/SettingsPanel";
import InlinePopup from "./ui/InlinePopup";
import SessionPicker from "./ui/SessionPicker";
import { flushAutosave, getSessions, loadDoc, scheduleAutosave } from "./state/sessions";

const autosaveExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged) scheduleAutosave(() => update.view.state.doc.toString());
});

export default function App() {
  const viewRef = useRef<EditorView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    window.addEventListener("beforeunload", flushAutosave);
    return () => window.removeEventListener("beforeunload", flushAutosave);
  }, []);

  // After a session switch/create/delete: load the new session's doc into a
  // fresh editor state (fresh undo history too).
  const handleSessionChange = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setState(
      EditorState.create({
        doc: loadDoc(getSessions().currentId),
        extensions: baseExtensions([autosaveExtension]),
      }),
    );
    view.focus();
  }, []);

  return (
    <div className="app">
      <TopBar
        viewRef={viewRef}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        sessionSlot={<SessionPicker onSessionChange={handleSessionChange} />}
      />
      <div className="main">
        <Editor
          initialDoc={loadDoc(getSessions().currentId)}
          extensions={[autosaveExtension]}
          onViewReady={(v) => (viewRef.current = v)}
        />
        {settingsOpen && <SettingsPanel />}
      </div>
      <InlinePopup />
    </div>
  );
}
