import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { appendChunk, beginStreamAt, endStream, streamState } from "./stream";
import { generatedMarks } from "./generatedMarks";
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

  it("preserves user edits made inside the generated text mid-stream", () => {
    const view = mockView("x");
    beginStreamAt(view, 1);
    appendChunk(view, "abc");
    // User fixes a "typo" inside the streamed text.
    view.dispatch({ changes: { from: 2, to: 3, insert: "B" }, userEvent: "input.type" });
    appendChunk(view, "def");
    endStream(view);
    expect(view.state.doc.toString()).toBe("xaBcdef");
  });

  it("drops decorations when generated text is deleted", () => {
    const view = mockView("");
    beginStreamAt(view, 0);
    appendChunk(view, "hello");
    endStream(view);
    view.dispatch({ changes: { from: 0, to: 5 }, userEvent: "delete" });
    expect(markedRanges(view)).toEqual([]);
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
