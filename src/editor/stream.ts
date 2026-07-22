import { StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { addGeneratedRange, generatedMarks, genStream, removeGeneratedRange } from "./generatedMarks";

interface StreamPos {
  /** Start of the generated region (maps through edits). */
  from: number;
  /** Insertion point for the next chunk. */
  head: number;
  /** Text the stream replaced (selection in rewrite mode; "" otherwise),
   * restored by the history swap so one undo brings it back. */
  replaced: string;
  /** Generated-mark layout of the replaced text, as local offsets. */
  replacedMarks: Array<{ from: number; to: number }>;
  /** Deferred-replace mode (rerolls): [from, hiddenTo) still holds the text
   * being replaced, hidden behind a replace decoration, while the new text
   * streams in at [hiddenTo, head). Deleting the old text up front would make
   * history map its own event away (addToHistory:false transactions still
   * remap stored events), so the actual replace waits for the end-of-stream
   * swap. null = plain mode, where beginStreamAt already deleted the range. */
  hiddenTo: number | null;
}

export interface StreamResult {
  committed: boolean;
  /** Restored selection range in the pre-generation document. */
  from: number;
  replacedLength: number;
  generatedLength: number;
}

const beginEffect = StateEffect.define<{
  from: number;
  replaced: string;
  replacedMarks: Array<{ from: number; to: number }>;
  hiddenTo: number | null;
}>();
const endEffect = StateEffect.define<null>();

const hiddenReplaced = Decoration.replace({});

/** The hidden-while-replacing range as a decoration set (deferred mode only). */
function hiddenDeco(pos: StreamPos | null): DecorationSet {
  return pos && pos.hiddenTo !== null && pos.hiddenTo > pos.from
    ? Decoration.set([hiddenReplaced.range(pos.from, pos.hiddenTo)])
    : Decoration.none;
}

export const streamState = StateField.define<StreamPos | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(beginEffect)) {
        return {
          from: e.value.from,
          head: e.value.hiddenTo ?? e.value.from,
          replaced: e.value.replaced,
          replacedMarks: e.value.replacedMarks,
          hiddenTo: e.value.hiddenTo,
        };
      }
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
      replacedMarks: value.replacedMarks,
      // Stays before chunk inserts at the boundary (assoc -1), keeping the
      // hidden range pinned to the old text rather than swallowing new output.
      hiddenTo: value.hiddenTo === null ? null : tr.changes.mapPos(value.hiddenTo, -1),
    };
  },
  provide: (f) => [
    EditorView.decorations.from(f, hiddenDeco),
    EditorView.atomicRanges.of((view) => hiddenDeco(view.state.field(f))),
  ],
});

export function isStreaming(view: EditorView): boolean {
  return view.state.field(streamState) !== null;
}

/** Start a stream at `from`; if `to > from`, the range is replaced (rewrite mode).
 * The deletion is kept out of history — the end-of-stream swap records the
 * whole replace as a single undoable event.
 *
 * With `deferReplace` (rerolls), the old range is not deleted: it stays in the
 * document, hidden by a decoration, while chunks stream in right after it.
 * That keeps every intermediate transaction a pure insert (later deleted
 * exactly), which history maps losslessly — so the previous option's own undo
 * event survives and the end-of-stream swap can chain option A <-> option B. */
export function beginStreamAt(
  view: EditorView,
  from: number,
  to = from,
  opts: { deferReplace?: boolean } = {},
) {
  const replaced = view.state.sliceDoc(from, to);
  if (opts.deferReplace) {
    view.dispatch({
      effects: beginEffect.of({ from, replaced, replacedMarks: [], hiddenTo: to }),
      annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
    });
    return;
  }
  const replacedMarks: Array<{ from: number; to: number }> = [];
  view.state.field(generatedMarks).between(from, to, (markFrom, markTo) => {
    const localFrom = Math.max(from, markFrom) - from;
    const localTo = Math.min(to, markTo) - from;
    if (localFrom < localTo) replacedMarks.push({ from: localFrom, to: localTo });
  });
  view.dispatch({
    changes: to > from ? { from, to } : undefined,
    effects: beginEffect.of({ from, replaced, replacedMarks, hiddenTo: null }),
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
 * the same task, so nothing is painted in between.
 *
 * `discard` forces the restore path even when text was generated — a reroll
 * that was aborted or errored keeps the option it was replacing instead of
 * committing a partial replacement. */
export function endStream(
  view: EditorView,
  commitEffects: (result: StreamResult) => readonly StateEffect<unknown>[] = () => [],
  restoreEffects: (result: StreamResult) => readonly StateEffect<unknown>[] = () => [],
  opts: { discard?: boolean } = {},
): StreamResult | null {
  const pos = view.state.field(streamState);
  if (!pos) return null;
  // Pin the viewport across the swap: the temporary delete/reinsert below
  // moves the DOM caret and can clamp/yank scroll between the dispatches.
  const scroll = typeof view.scrollSnapshot === "function" ? view.scrollSnapshot() : null;
  const { from, head, replaced, replacedMarks, hiddenTo } = pos;
  const deferred = hiddenTo !== null;
  // In deferred mode the old text still sits at [from, hiddenTo) and the
  // streamed text after it; in plain mode the stream starts at `from`.
  const streamedFrom = hiddenTo ?? from;
  const end = Math.max(streamedFrom, head);
  const text = view.state.sliceDoc(streamedFrom, end);
  const committed = !opts.discard && text !== "" && text !== replaced;
  const result = {
    committed,
    from,
    replacedLength: replaced.length,
    generatedLength: text.length,
  };
  const selectionWasInside =
    view.state.selection.main.from >= from && view.state.selection.main.to <= end;

  // Capture the tint layout before the swap (as offsets into `text`): user
  // edits made mid-stream have punched untinted holes that the re-insert
  // below must reproduce instead of tinting the whole block.
  const pieces: Array<{ from: number; to: number }> = [];
  view.state.field(generatedMarks).between(streamedFrom, end, (f, t) => {
    const pf = Math.max(f, streamedFrom) - streamedFrom;
    const pt = Math.min(t, end) - streamedFrom;
    if (pf >= pt) return;
    const last = pieces[pieces.length - 1];
    if (last && last.to >= pf) last.to = Math.max(last.to, pt); // coalesce adjacent chunks
    else pieces.push({ from: pf, to: pt });
  });

  // Revert to pre-stream content, outside history. In plain mode that means
  // reinserting the replaced text (deletion collapses the per-chunk decoration
  // ranges; the explicit remove clears any mark that would otherwise map onto
  // the restored original). In deferred mode the old text never left the doc,
  // so only the streamed region is deleted (and the hide decoration lifted).
  view.dispatch({
    changes: deferred
      ? end > streamedFrom
        ? { from: streamedFrom, to: end }
        : undefined
      : { from, to: end, insert: replaced },
    effects: [
      endEffect.of(null),
      ...(!deferred && replaced.length
        ? [removeGeneratedRange.of({ from, to: from + replaced.length })]
        : []),
      ...(!deferred
        ? replacedMarks.map((mark) =>
            addGeneratedRange.of({ from: from + mark.from, to: from + mark.to }),
          )
        : []),
      ...restoreEffects(result),
    ],
    annotations: [genStream.of(true), Transaction.addToHistory.of(false)],
  });

  // Nothing generated (or nothing changed): keep the restored original and
  // record no history event.
  if (committed) {
    // Post-revert, the old content occupies [from, oldTo) in both modes.
    const oldTo = deferred ? streamedFrom : from + replaced.length;
    view.dispatch({
      changes: { from, to: oldTo, insert: text },
      effects: [
        ...pieces.map((p) => addGeneratedRange.of({ from: from + p.from, to: from + p.to })),
        ...commitEffects(result),
      ],
      annotations: [
        genStream.of(true),
        Transaction.userEvent.of("input.generate"),
        // Rerolls isolate fully: joining with an adjacent user edit would make
        // one undo swallow both the edit and the replacement.
        isolateHistory.of(deferred ? "full" : "after"),
      ],
      ...(selectionWasInside ? { selection: { anchor: from + text.length } } : {}),
    });
  }

  if (scroll) view.dispatch({ effects: scroll });
  return result;
}
