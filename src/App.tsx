import { useRef } from "react";
import { EditorView } from "@codemirror/view";
import Editor from "./editor/Editor";
import { beginStreamAt, appendChunk, endStream, isStreaming } from "./editor/stream";

const LOREM =
  "The rain had been falling for three days when the lighthouse keeper first noticed the ship. It sat motionless on the horizon, a dark smudge against darker water, and no matter how long he watched, it never seemed to drift.".split(
    " ",
  );

// Dev-only harness for exercising the streaming machinery without a network.
function demoStream(view: EditorView, delayMs: number) {
  if (isStreaming(view)) return;
  const pos = view.state.selection.main.head;
  beginStreamAt(view, pos);
  let i = 0;
  const timer = setInterval(() => {
    if (!isStreaming(view) || i >= LOREM.length) {
      clearInterval(timer);
      endStream(view);
      return;
    }
    appendChunk(view, (i === 0 ? "" : " ") + LOREM[i++]);
  }, delayMs);
}

export default function App() {
  const viewRef = useRef<EditorView | null>(null);

  return (
    <div className="app">
      {import.meta.env.DEV && (
        <div className="dev-toolbar">
          <button onClick={() => viewRef.current && demoStream(viewRef.current, 50)}>demo 50ms</button>
          <button onClick={() => viewRef.current && demoStream(viewRef.current, 900)}>demo 900ms</button>
          <button onClick={() => viewRef.current && endStream(viewRef.current)}>stop</button>
        </div>
      )}
      <Editor initialDoc="" onViewReady={(v) => (viewRef.current = v)} />
    </div>
  );
}
