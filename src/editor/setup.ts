import { EditorView, keymap, placeholder, drawSelection } from "@codemirror/view";
import { Extension, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { generatedMarksExtension } from "./generatedMarks";
import { streamState } from "./stream";
import { cancelGeneration, startGeneration } from "../gen/engine";
import { openPopup } from "../ui/popupStore";

const genKeymap = Prec.high(
  keymap.of([
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
    padding: "2.5rem 1.5rem 40vh",
    caretColor: "var(--fg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0" },
  ".cm-generated": { background: "var(--tint)", borderRadius: "2px" },
  ".cm-placeholder": { color: "var(--muted)", fontStyle: "italic" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
});

export function baseExtensions(extra: Extension[] = []): Extension[] {
  return [
    EditorView.lineWrapping,
    genKeymap,
    history(),
    drawSelection(),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    placeholder("Start writing…"),
    proseTheme,
    streamState,
    generatedMarksExtension,
    ...extra,
  ];
}
