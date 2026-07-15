import { Annotation, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { addGeneratedRange } from "./generatedMarks";

/** Tags transactions produced by the generation stream itself. */
export const genStream = Annotation.define<boolean>();

interface StreamPos {
  /** Start of the generated region (maps through edits). */
  from: number;
  /** Insertion point for the next chunk. */
  head: number;
  /** Text the stream replaced (selection in rewrite mode; "" otherwise),
   * restored by the history swap so one undo brings it back. */
  replaced: string;
}

const beginEffect = StateEffect.define<{ from: number; replaced: string }>();
const endEffect = StateEffect.define<null>();

export const streamState = StateField.define<StreamPos | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(beginEffect)) return { from: e.value.from, head: e.value.from, replaced: e.value.replaced };
      if (e.is(endEffect)) return null;
    }
    if (!value || !tr.docChanged) return value;
    const isGen = tr.annotation(genStream) === true;
    // Own inserts land at head and the head must advance past them (assoc 1).
    // User edits at the head stay after it (assoc -1) so model output remains
    // contiguous with what it has already written.
    return {
      from: tr.changes.mapPos(value.from, -1),
      head: tr.changes.mapPos(value.head, isGen ? 1 : -1),
      replaced: value.replaced,
    };
  },
});

export function isStreaming(view: EditorView): boolean {
  return view.state.field(streamState) !== null;
}

/** Start a stream at `from`; if `to > from`, the range is replaced (rewrite mode).
 * The deletion is kept out of history — the end-of-stream swap records the
 * whole replace as a single undoable event. */
export function beginStreamAt(view: EditorView, from: number, to = from) {
  const replaced = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: to > from ? { from, to } : undefined,
    effects: beginEffect.of({ from, replaced }),
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Insert one streamed chunk at the current head, outside undo history. */
export function appendChunk(view: EditorView, chunk: string) {
  const pos = view.state.field(streamState);
  if (!pos || !chunk) return;
  view.dispatch({
    changes: { from: pos.head, insert: chunk },
    effects: addGeneratedRange.of({ from: pos.head, to: pos.head + chunk.length }),
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Finish (or cancel) the stream. Performs the history swap: the generated
 * region is reverted to its pre-stream content outside history, then the final
 * text is applied as ONE history event, so a single undo removes the whole
 * generation and restores any replaced selection. Both dispatches happen in
 * the same task, so nothing is painted in between. */
export function endStream(view: EditorView) {
  const pos = view.state.field(streamState);
  if (!pos) return;
  const { from, head, replaced } = pos;
  const text = view.state.sliceDoc(from, Math.max(from, head));
  const selectionWasInside =
    view.state.selection.main.from >= from && view.state.selection.main.to <= Math.max(from, head);

  // Revert to pre-stream content, outside history. Collapses all per-chunk
  // decoration ranges too.
  view.dispatch({
    changes: { from, to: Math.max(from, head), insert: replaced },
    effects: endEffect.of(null),
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });

  // Nothing generated (or nothing changed): keep the restored original and
  // record no history event.
  if (text === "" || text === replaced) return;

  view.dispatch({
    changes: { from, to: from + replaced.length, insert: text },
    effects: addGeneratedRange.of({ from, to: from + text.length }),
    annotations: [genStream.of(true), Transaction.userEvent.of("input.generate")],
    ...(selectionWasInside ? { selection: { anchor: from + text.length } } : {}),
  });
}
