import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

/** Marks ranges of model-generated text so they render with a subtle tint.
 * Positions in the effect refer to the transaction's new document. */
export const addGeneratedRange = StateEffect.define<{ from: number; to: number }>({
  map: ({ from, to }, mapping) => ({
    from: mapping.mapPos(from),
    to: mapping.mapPos(to),
  }),
});

const generatedMark = Decoration.mark({ class: "cm-generated" });

export const generatedMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addGeneratedRange) && e.value.to > e.value.from) {
        deco = deco.update({ add: [generatedMark.range(e.value.from, e.value.to)] });
      }
    }
    if (tr.docChanged) {
      deco = deco.update({ filter: (from, to) => from < to });
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
