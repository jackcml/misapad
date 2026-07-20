import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { generatedMarksExtension } from "./generatedMarks";
import { characterStats, selectedCharacterCount } from "./selectionCount";

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

  it("reports document characters and generated share without a selection", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [generatedMarksExtension([[6, 11]])],
    });

    expect(characterStats(state)).toEqual({
      count: 11,
      generatedCount: 5,
      generatedPercentage: 45,
      isSelection: false,
    });
  });

  it("reports selected characters and generated share within the selection", () => {
    const state = EditorState.create({
      doc: "hello world",
      selection: EditorSelection.single(4, 9),
      extensions: [generatedMarksExtension([[6, 11]])],
    });

    expect(characterStats(state)).toEqual({
      count: 5,
      generatedCount: 3,
      generatedPercentage: 60,
      isSelection: true,
    });
  });

  it("reports zero generated share for an empty document", () => {
    const state = EditorState.create({ extensions: [generatedMarksExtension()] });

    expect(characterStats(state)).toEqual({
      count: 0,
      generatedCount: 0,
      generatedPercentage: 0,
      isSelection: false,
    });
  });
});
