import { EditorView } from "@codemirror/view";
import { redoDepth, undoDepth } from "@codemirror/commands";
import { generationRetryState } from "../editor/generationRetry";
import { redoUnlessStreaming, undoUnlessStreaming } from "../editor/history";
import { isStreaming } from "../editor/stream";
import {
  cancelGeneration,
  replaceLastGeneration,
  startGeneration,
  useGenStatus,
} from "../gen/engine";
import { createStore } from "../state/store";
import { openPopup } from "./popupStore";
import { useKeyboard } from "./useKeyboard";

interface BarStatus {
  canUndo: boolean;
  canRedo: boolean;
  canReroll: boolean;
}

const barStatus = createStore<BarStatus>({ canUndo: false, canRedo: false, canReroll: false });

export function syncMobileBarStatus(view: EditorView) {
  const streaming = isStreaming(view);
  const next: BarStatus = {
    canUndo: !streaming && undoDepth(view.state) > 0,
    canRedo: !streaming && redoDepth(view.state) > 0,
    canReroll: view.state.field(generationRetryState, false) != null || isStreaming(view),
  };
  const prev = barStatus.get();
  if (
    next.canUndo !== prev.canUndo ||
    next.canRedo !== prev.canRedo ||
    next.canReroll !== prev.canReroll
  ) {
    barStatus.set(next);
  }
}

export const mobileBarStatusExtension = EditorView.updateListener.of((update) => {
  syncMobileBarStatus(update.view);
});

interface MobileBarProps {
  viewRef: React.RefObject<EditorView | null>;
}

/** Touch controls for the keyboard-only actions. Rendered always, shown only
 * on coarse-pointer devices via CSS. */
export default function MobileBar({ viewRef }: MobileBarProps) {
  const { canUndo, canRedo, canReroll } = barStatus.use();
  const status = useGenStatus();
  const keyboard = useKeyboard();
  const generating = status.state === "generating";

  // Keyboard open: pin the bar's bottom edge to the visual viewport's bottom
  // (just above the keyboard). Closed: the CSS bottom anchoring applies.
  const style: React.CSSProperties | undefined = keyboard.open
    ? { top: keyboard.bottom - 12, bottom: "auto", transform: "translate(-50%, -100%)" }
    : undefined;

  const withView = (fn: (view: EditorView) => void) => () => {
    const view = viewRef.current;
    if (view) fn(view);
  };

  // Cancel the focus-stealing default so a tap never blurs the editor and
  // dismisses the keyboard mid-writing; click events still fire.
  const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <div
      className="mobile-bar"
      style={style}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
    >
      <button
        disabled={!canUndo}
        onClick={withView(undoUnlessStreaming)}
        aria-label="Undo"
      >
        ↩
      </button>
      <button
        disabled={!canRedo}
        onClick={withView(redoUnlessStreaming)}
        aria-label="Redo"
      >
        ↪
      </button>
      {generating ? (
        <button className="primary" onClick={() => cancelGeneration()} aria-label="Stop">
          ■
        </button>
      ) : (
        <button
          className="primary"
          onClick={withView((v) => void startGeneration(v, "continue"))}
          aria-label="Continue"
        >
          ▶
        </button>
      )}
      <button
        disabled={!canReroll}
        onClick={withView((v) => void replaceLastGeneration(v))}
        aria-label="Reroll generation"
      >
        ⟳
      </button>
      <button onClick={withView(openPopup)} aria-label="Instruct">
        ✎
      </button>
    </div>
  );
}
