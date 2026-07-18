import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { isolateHistory, undo, redo } from "@codemirror/commands";
import { appendChunk, beginStreamAt, endStream, streamState } from "./stream";
import { generatedMarks, serializeGeneratedRanges } from "./generatedMarks";
import { mockView } from "../testing/mockView";

function markedRanges(view: EditorView): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  view.state.field(generatedMarks).between(0, view.state.doc.length, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe("streaming machinery", () => {
  it("streams chunks at the head and marks them generated", () => {
    const view = mockView("Once upon a time");
    beginStreamAt(view, 16);
    appendChunk(view, " there");
    appendChunk(view, " was");
    endStream(view);
    expect(view.state.doc.toString()).toBe("Once upon a time there was");
    expect(markedRanges(view)).toEqual([[16, 26]]);
  });

  it("collapses a whole generation into one undo unit regardless of chunk count", () => {
    const view = mockView("abc");
    beginStreamAt(view, 3);
    for (const c of ["1", "2", "3", "4", "5"]) appendChunk(view, c);
    endStream(view);
    expect(view.state.doc.toString()).toBe("abc12345");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("abc");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("abc12345");
  });

  it("keeps the insertion point stable while the user edits upstream", () => {
    const view = mockView("Hello world.");
    beginStreamAt(view, 12);
    appendChunk(view, " The");
    // User inserts text at the start of the doc mid-stream (a normal history event).
    view.dispatch({ changes: { from: 0, insert: "Chapter 1. " }, userEvent: "input.type" });
    appendChunk(view, " end.");
    endStream(view);
    expect(view.state.doc.toString()).toBe("Chapter 1. Hello world. The end.");
    // One undo removes the whole generation but keeps the user's edit.
    undo(view as any);
    expect(view.state.doc.toString()).toBe("Chapter 1. Hello world.");
  });

  it("restores a replaced selection with a single undo (rewrite mode)", () => {
    const view = mockView("The quick brown fox");
    beginStreamAt(view, 4, 9); // replace "quick"
    expect(view.state.doc.toString()).toBe("The  brown fox");
    appendChunk(view, "sly");
    appendChunk(view, " old");
    endStream(view);
    expect(view.state.doc.toString()).toBe("The sly old brown fox");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("The quick brown fox");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("The sly old brown fox");
  });

  it("restores the original text when a rewrite produces nothing", () => {
    const view = mockView("The quick brown fox");
    beginStreamAt(view, 4, 9);
    endStream(view);
    expect(view.state.doc.toString()).toBe("The quick brown fox");
    expect(view.state.field(streamState)).toBeNull();
  });

  it("preserves user edits made inside the generated text mid-stream, untinted", () => {
    const view = mockView("x");
    beginStreamAt(view, 1);
    appendChunk(view, "abc");
    // User fixes a "typo" inside the streamed text.
    view.dispatch({ changes: { from: 2, to: 3, insert: "B" }, userEvent: "input.type" });
    appendChunk(view, "def");
    endStream(view);
    expect(view.state.doc.toString()).toBe("xaBcdef");
    // The user-typed "B" is not the model's text: it stays untinted.
    expect(markedRanges(view)).toEqual([
      [1, 2],
      [3, 7],
    ]);
  });

  it("typing inside a completed generation splits the tint around the typed text", () => {
    const view = mockView("");
    beginStreamAt(view, 0);
    appendChunk(view, "hello");
    endStream(view);
    expect(markedRanges(view)).toEqual([[0, 5]]);
    // isolateHistory: in the test both dispatches land in the same ms, which
    // would otherwise join the typing into the generation's undo group.
    view.dispatch({
      changes: { from: 2, insert: "XY" },
      userEvent: "input.type",
      annotations: isolateHistory.of("before"),
    });
    expect(view.state.doc.toString()).toBe("heXYllo");
    expect(markedRanges(view)).toEqual([
      [0, 2],
      [4, 7],
    ]);
    // Undo the typing: tint closes back up; redo re-splits.
    undo(view as any);
    expect(markedRanges(view)).toEqual([
      [0, 2],
      [2, 5],
    ]);
    redo(view as any);
    expect(markedRanges(view)).toEqual([
      [0, 2],
      [4, 7],
    ]);
  });

  it("round-trips tint through serialize + init (persistence)", () => {
    const view = mockView("She wrote. ");
    beginStreamAt(view, 11);
    appendChunk(view, "The model wrote this part");
    endStream(view);
    view.dispatch({ changes: { from: 15, insert: "[me]" }, userEvent: "input.type" });
    const saved = serializeGeneratedRanges(view.state);
    expect(saved).toEqual([
      [11, 15],
      [19, 40],
    ]);
    // "Reload": a fresh view seeded with the persisted doc + ranges.
    const restored = mockView(view.state.doc.toString(), 0, saved);
    expect(markedRanges(restored)).toEqual(saved);
    // Restoration is not undoable — history starts clean.
    undo(restored as any);
    expect(markedRanges(restored)).toEqual(saved);
  });

  it("clamps and drops invalid persisted ranges", () => {
    const view = mockView("short", 0, [
      [0, 3],
      [2, 999], // clamped to doc length
      [4, 4], // empty → dropped
      ["x", 2] as unknown as [number, number], // garbage → dropped
    ]);
    expect(markedRanges(view)).toEqual([
      [0, 3],
      [2, 5],
    ]);
  });

  it("does not extend tint when typing at a generation's edges", () => {
    const view = mockView("ab");
    beginStreamAt(view, 2);
    appendChunk(view, "cd");
    endStream(view);
    view.dispatch({ changes: { from: 2, insert: "!" }, userEvent: "input.type" }); // before
    view.dispatch({ changes: { from: 5, insert: "?" }, userEvent: "input.type" }); // after
    expect(view.state.doc.toString()).toBe("ab!cd?");
    expect(markedRanges(view)).toEqual([[3, 5]]);
  });

  it("drops decorations when generated text is deleted", () => {
    const view = mockView("");
    beginStreamAt(view, 0);
    appendChunk(view, "hello");
    endStream(view);
    view.dispatch({ changes: { from: 0, to: 5 }, userEvent: "delete" });
    expect(markedRanges(view)).toEqual([]);
  });

  it("clears tint from restored text when undoing a single-chunk rewrite", () => {
    // Regression: with one big chunk, the mark used to survive the end-of-
    // stream swap by mapping onto the restored original text.
    const view = mockView("The quick brown fox");
    beginStreamAt(view, 4, 9);
    appendChunk(view, " there was more.");
    endStream(view);
    expect(markedRanges(view)).toEqual([[4, 20]]);
    undo(view as any);
    expect(view.state.doc.toString()).toBe("The quick brown fox");
    expect(markedRanges(view)).toEqual([]);
  });

  it("does not leave a zombie undo after rewriting a generated range", () => {
    const view = mockView("seed");
    beginStreamAt(view, 4);
    appendChunk(view, " old");
    endStream(view);

    // A normal rewrite deletes the old generated range outside history while
    // it streams, so CodeMirror absorbs that range's original history change.
    beginStreamAt(view, 4, 8);
    appendChunk(view, " new");
    endStream(view);
    expect(view.state.doc.toString()).toBe("seed new");

    expect(undo(view as any)).toBe(true);
    expect(view.state.doc.toString()).toBe("seed old");
    // The absorbed event must disappear completely, rather than survive as a
    // degenerate mark effect that consumes a second Ctrl+Z without a change.
    expect(undo(view as any)).toBe(false);
  });

  it("generates again after undoing a previous generation", () => {
    // Regression: inverted mark effects were stored in post-generation doc
    // coordinates, so after an undo shrank the doc, the next generation's
    // first chunk made history re-map them and throw
    // "Position N is out of range for changeset of length M".
    const view = mockView("abc");
    beginStreamAt(view, 3);
    appendChunk(view, "12345");
    endStream(view);
    undo(view as any);
    expect(view.state.doc.toString()).toBe("abc");
    beginStreamAt(view, 3);
    appendChunk(view, "Z");
    endStream(view);
    expect(view.state.doc.toString()).toBe("abcZ");
    expect(markedRanges(view)).toEqual([[3, 4]]);
    expect(undo(view as any)).toBe(true);
    expect(view.state.doc.toString()).toBe("abc");
    expect(undo(view as any)).toBe(false);
  });

  it("survives repeated generate/undo/generate cycles", () => {
    const view = mockView("seed");
    for (let i = 0; i < 5; i++) {
      beginStreamAt(view, view.state.doc.length);
      appendChunk(view, ` gen${i} part one,`);
      appendChunk(view, " part two.");
      endStream(view);
      undo(view as any);
    }
    expect(view.state.doc.toString()).toBe("seed");
    beginStreamAt(view, 4);
    appendChunk(view, " final");
    endStream(view);
    expect(view.state.doc.toString()).toBe("seed final");
  });

  it("undo removes the tint and redo restores it", () => {
    const view = mockView("ab");
    beginStreamAt(view, 2);
    appendChunk(view, "cd");
    endStream(view);
    expect(markedRanges(view)).toEqual([[2, 4]]);
    undo(view as any);
    expect(markedRanges(view)).toEqual([]);
    redo(view as any);
    expect(view.state.doc.toString()).toBe("abcd");
    expect(markedRanges(view)).toEqual([[2, 4]]);
  });
});
