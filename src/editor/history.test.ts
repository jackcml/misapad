import { describe, expect, it } from "vitest";
import { undo } from "@codemirror/commands";
import { appendChunk, beginStreamAt } from "./stream";
import { serializeGeneratedRanges } from "./generatedMarks";
import { redoUnlessStreaming, undoUnlessStreaming } from "./history";
import { mockView } from "../testing/mockView";

function snapshot(view: ReturnType<typeof mockView>) {
  return {
    doc: view.state.doc.toString(),
    marks: serializeGeneratedRanges(view.state),
  };
}

describe("stream-aware history commands", () => {
  it("blocks undo while a generation is streaming", () => {
    const view = mockView("seed");
    view.dispatch({ changes: { from: 4, insert: "X" }, userEvent: "input.type" });
    beginStreamAt(view, 5);
    appendChunk(view, " generated");
    const before = snapshot(view);

    expect(undoUnlessStreaming(view)).toBe(true);
    expect(snapshot(view)).toEqual(before);
  });

  it("blocks redo while a generation is streaming", () => {
    const view = mockView("seed");
    view.dispatch({ changes: { from: 4, insert: "X" }, userEvent: "input.type" });
    expect(undo(view as any)).toBe(true);
    beginStreamAt(view, 4);
    appendChunk(view, " generated");
    const before = snapshot(view);

    expect(redoUnlessStreaming(view)).toBe(true);
    expect(snapshot(view)).toEqual(before);
  });
});
