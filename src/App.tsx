import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import Editor from "./editor/Editor";
import { baseExtensions } from "./editor/setup";
import { serializeGeneratedRanges } from "./editor/generatedMarks";
import TopBar from "./ui/TopBar";
import SettingsPanel from "./ui/SettingsPanel";
import InlinePopup from "./ui/InlinePopup";
import SessionPicker from "./ui/SessionPicker";
import { flushAutosave, getSessions, loadDoc, loadMarks, scheduleAutosave } from "./state/sessions";
import { cancelGeneration } from "./gen/engine";

const autosaveExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    scheduleAutosave(() => ({
      text: update.view.state.doc.toString(),
      marks: serializeGeneratedRanges(update.view.state),
    }));
  }
});

export default function App() {
  const viewRef = useRef<EditorView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    window.addEventListener("beforeunload", flushAutosave);
    return () => window.removeEventListener("beforeunload", flushAutosave);
  }, []);

  // After a session switch/create/delete: load the new session's doc and tint
  // into a fresh editor state (fresh undo history too).
  const handleSessionChange = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    cancelGeneration();
    const id = getSessions().currentId;
    view.setState(
      EditorState.create({
        doc: loadDoc(id),
        extensions: baseExtensions([autosaveExtension], loadMarks(id)),
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
          initialMarks={loadMarks(getSessions().currentId)}
          extensions={[autosaveExtension]}
          onViewReady={(v) => (viewRef.current = v)}
        />
        {settingsOpen && <SettingsPanel />}
      </div>
      <InlinePopup />
    </div>
  );
}
