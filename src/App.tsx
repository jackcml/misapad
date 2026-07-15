import { useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import Editor from "./editor/Editor";
import TopBar from "./ui/TopBar";
import SettingsPanel from "./ui/SettingsPanel";
import InlinePopup from "./ui/InlinePopup";

export default function App() {
  const viewRef = useRef<EditorView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app">
      <TopBar viewRef={viewRef} onToggleSettings={() => setSettingsOpen((v) => !v)} />
      <div className="main">
        <Editor initialDoc="" onViewReady={(v) => (viewRef.current = v)} />
        {settingsOpen && <SettingsPanel />}
      </div>
      <InlinePopup />
    </div>
  );
}
