import { StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { addGeneratedRange, generatedMarks, genStream, removeGeneratedRange } from "./generatedMarks";

export { genStream };

interface StreamPos {
  /** Start of the generated region (maps through edits). */
  from: number;
  /** Insertion point for the next chunk. */
  head: number;
  /** Text the stream replaced (selection in rewrite mode; "" otherwise),
   * restored by the history swap so one undo brings it back. */
  replaced: string;
}

export interface StreamResult {
  committed: boolean;
  /** Restored selection range in the pre-generation document. */
  from: number;
  replacedLength: number;
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

/** True when `pos` is rendered inside (or within `slack` px below) the
 * scroller's viewport. The slack keeps follow-mode alive when the streaming
 * head wraps onto a new line just past the fold between chunks, while a user
 * who scrolled away leaves it hundreds of pixels behind.
 * False (never throws) on headless views without layout. */
function posIsVisible(view: EditorView, pos: number, slack = 0): boolean {
  try {
    const coords = view.coordsAtPos(pos);
    if (!coords) return false;
    const rect = view.scrollDOM.getBoundingClientRect();
    return coords.bottom > rect.top && coords.top < rect.bottom + slack;
  } catch {
    return false;
  }
}

/** Insert one streamed chunk at the current head, outside undo history.
 * Scroll policy: follow the stream only while its head is on screen — once
 * the user scrolls away to read, leave their viewport alone. */
export function appendChunk(view: EditorView, chunk: string) {
  const pos = view.state.field(streamState);
  if (!pos || !chunk) return;
  const follow = posIsVisible(view, pos.head, 60);
  const changes = view.state.changes({ from: pos.head, insert: chunk });
  view.dispatch({
    changes,
    // Keep the selection from riding the insertion point: a caret pinned to
    // the head makes the browser's caret-sync yank the viewport to it on
    // every chunk, even after the user scrolled away.
    selection: view.state.selection.map(changes, -1),
    effects: [
      addGeneratedRange.of({ from: pos.head, to: pos.head + chunk.length }),
      ...(follow ? [EditorView.scrollIntoView(pos.head + chunk.length, { y: "nearest" })] : []),
    ],
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Finish (or cancel) the stream. Performs the history swap: the generated
 * region is reverted to its pre-stream content outside history, then the final
 * text is applied as ONE history event, so a single undo removes the whole
 * generation and restores any replaced selection. Both dispatches happen in
 * the same task, so nothing is painted in between. */
export function endStream(
  view: EditorView,
  commitEffects: (result: StreamResult) => readonly StateEffect<unknown>[] = () => [],
): StreamResult | null {
  const pos = view.state.field(streamState);
  if (!pos) return null;
  // Pin the viewport across the swap: the temporary delete/reinsert below
  // moves the DOM caret and can clamp/yank scroll between the dispatches.
  const scroll = typeof view.scrollSnapshot === "function" ? view.scrollSnapshot() : null;
  const { from, head, replaced } = pos;
  const end = Math.max(from, head);
  const text = view.state.sliceDoc(from, end);
  const selectionWasInside =
    view.state.selection.main.from >= from && view.state.selection.main.to <= end;

  // Capture the tint layout before the swap (as offsets into `text`): user
  // edits made mid-stream have punched untinted holes that the re-insert
  // below must reproduce instead of tinting the whole block.
  const pieces: Array<{ from: number; to: number }> = [];
  view.state.field(generatedMarks).between(from, end, (f, t) => {
    const pf = Math.max(f, from) - from;
    const pt = Math.min(t, end) - from;
    if (pf >= pt) return;
    const last = pieces[pieces.length - 1];
    if (last && last.to >= pf) last.to = Math.max(last.to, pt); // coalesce adjacent chunks
    else pieces.push({ from: pf, to: pt });
  });

  // Revert to pre-stream content, outside history. Deletion collapses the
  // per-chunk decoration ranges; the explicit remove clears any mark that
  // would otherwise map onto the restored original text.
  view.dispatch({
    changes: { from, to: end, insert: replaced },
    effects: [
      endEffect.of(null),
      ...(replaced.length ? [removeGeneratedRange.of({ from, to: from + replaced.length })] : []),
    ],
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });

  // Nothing generated (or nothing changed): keep the restored original and
  // record no history event.
  const committed = text !== "" && text !== replaced;
  const result = { committed, from, replacedLength: replaced.length };
  if (committed) {
    view.dispatch({
      changes: { from, to: from + replaced.length, insert: text },
      effects: [
        ...pieces.map((p) => addGeneratedRange.of({ from: from + p.from, to: from + p.to })),
        ...commitEffects(result),
      ],
      annotations: [
        genStream.of(true),
        Transaction.userEvent.of("input.generate"),
        isolateHistory.of("after"),
      ],
      ...(selectionWasInside ? { selection: { anchor: from + text.length } } : {}),
    });
  }

  if (scroll) view.dispatch({ effects: scroll });
  return result;
}
