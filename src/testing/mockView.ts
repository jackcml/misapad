import { EditorState, EditorSelection, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { streamState } from "../editor/stream";
import { generatedMarksExtension } from "../editor/generatedMarks";
import { generationRetryExtension } from "../editor/generationRetry";

/** Headless stand-in for EditorView: enough surface for the stream helpers,
 * the engine, and the undo/redo commands. No DOM required. */
export function mockView(doc: string, cursor = doc.length, initialMarks: Array<[number, number]> = []) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [history(), streamState, generatedMarksExtension(initialMarks), generationRetryExtension],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  };
  return view as unknown as EditorView;
}
