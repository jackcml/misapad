import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { selectedCharacterCount } from "./selectionCount";

describe("selection character count", () => {
  it("is zero for a caret and counts the active selection", () => {
    const caret = EditorState.create({ doc: "hello", selection: EditorSelection.cursor(2) });
    const selected = EditorState.create({
      doc: "hello world",
      selection: EditorSelection.single(2, 9),
    });

    expect(selectedCharacterCount(caret)).toBe(0);
    expect(selectedCharacterCount(selected)).toBe(7);
  });

  it("totals multiple selection ranges", () => {
    const state = EditorState.create({
      doc: "one two three",
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(8, 13),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });

    expect(selectedCharacterCount(state)).toBe(8);
  });
});
