import { EditorView, keymap, placeholder, drawSelection } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { generatedMarks } from "./generatedMarks";
import { streamState } from "./stream";

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
    history(),
    drawSelection(),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    placeholder("Start writing…"),
    proseTheme,
    streamState,
    generatedMarks,
    ...extra,
  ];
}
