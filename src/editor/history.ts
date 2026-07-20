import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { isStreaming } from "./stream";

/**
 * A stream does not enter history until endStream commits its final swap.
 * Consuming history commands in the meantime would undo or redo an earlier
 * edit underneath the still-running generation.
 */
export function undoUnlessStreaming(view: EditorView): boolean {
  return isStreaming(view) || undo(view);
}

export function redoUnlessStreaming(view: EditorView): boolean {
  return isStreaming(view) || redo(view);
}
