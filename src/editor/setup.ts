import { EditorView, keymap, placeholder, drawSelection } from "@codemirror/view";
import { EditorState, Extension, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { generatedMarksExtension } from "./generatedMarks";
import { generationRetryExtension } from "./generationRetry";
import { selectionCountExtension } from "./selectionCount";
import { searchPanelFocusExtension } from "./searchPanel";
import { streamState } from "./stream";
import { redoUnlessStreaming, undoUnlessStreaming } from "./history";
import { cancelGeneration, replaceLastGeneration, startGeneration } from "../gen/engine";
import { openPopup } from "../ui/popupStore";

const genKeymap = Prec.high(
  keymap.of([
    {
      key: "Mod-Shift-Enter",
      run: (view) => {
        void replaceLastGeneration(view);
        return true;
      },
    },
    {
      key: "Mod-Enter",
      run: (view) => {
        void startGeneration(view, "continue");
        return true;
      },
    },
    {
      key: "Mod-k",
      run: (view) => {
        openPopup(view);
        return true;
      },
    },
    {
      key: "Escape",
      run: () => cancelGeneration(),
    },
    { key: "Mod-z", run: undoUnlessStreaming },
    { key: "Mod-y", run: redoUnlessStreaming },
    { key: "Mod-Shift-z", run: redoUnlessStreaming },
  ]),
);

const proseTheme = EditorView.theme({
  "&": {
    fontSize: "17px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "Georgia, 'Times New Roman', serif",
    lineHeight: "1.65",
    justifyContent: "center",
  },
  ".cm-content": {
    maxWidth: "46rem",
    // Keep horizontal padding on .cm-line, not here: drawSelection clips its
    // multi-line highlight rectangles to the content box minus line padding,
    // so content-level side padding gets painted over.
    padding: "2.5rem 0 40vh",
    caretColor: "var(--fg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 1.5rem" },
  ".cm-generated": { background: "var(--tint)", borderRadius: "2px" },
  ".cm-placeholder": { color: "var(--muted)", fontStyle: "italic" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
});

export function baseExtensions(
  extra: Extension[] = [],
  initialMarks: Array<[number, number]> = [],
): Extension[] {
  return [
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    EditorState.phrases.of({ all: "select all" }),
    genKeymap,
    history(),
    search({ top: true }),
    drawSelection(),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    placeholder("Start writing…"),
    proseTheme,
    streamState,
    generatedMarksExtension(initialMarks),
    generationRetryExtension,
    selectionCountExtension,
    searchPanelFocusExtension,
    ...extra,
  ];
}
