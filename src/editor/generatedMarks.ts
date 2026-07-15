import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";

/** Marks ranges of model-generated text so they render with a subtle tint.
 * Positions in the effects refer to the transaction's new document. */
export const addGeneratedRange = StateEffect.define<{ from: number; to: number }>({
  map: ({ from, to }, mapping) => ({ from: mapping.mapPos(from), to: mapping.mapPos(to) }),
});

export const removeGeneratedRange = StateEffect.define<{ from: number; to: number }>({
  map: ({ from, to }, mapping) => ({ from: mapping.mapPos(from), to: mapping.mapPos(to) }),
});

const generatedMark = Decoration.mark({ class: "cm-generated" });

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addGeneratedRange) && e.value.to > e.value.from) {
        // Undo inversion can produce the same range twice (once from the
        // inverted remove effect, once from the deleted-range scan).
        let dup = false;
        deco.between(e.value.from, e.value.to, (f, t) => {
          if (f === e.value.from && t === e.value.to) {
            dup = true;
            return false;
          }
        });
        if (!dup) deco = deco.update({ add: [generatedMark.range(e.value.from, e.value.to)] });
      } else if (e.is(removeGeneratedRange)) {
        deco = deco.update({
          filterFrom: e.value.from,
          filterTo: e.value.to,
          filter: (from, to) => to <= e.value.from || from >= e.value.to,
        });
      }
    }
    if (tr.docChanged) {
      deco = deco.update({ filter: (from, to) => from < to });
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Make undo/redo restore/remove tint alongside the text: invert explicit
 * add/remove effects, and re-add any marked ranges a change deleted. */
const invertMarks = invertedEffects.of((tr) => {
  const effects: StateEffect<{ from: number; to: number }>[] = [];
  for (const e of tr.effects) {
    if (e.is(addGeneratedRange)) effects.push(removeGeneratedRange.of(e.value));
    else if (e.is(removeGeneratedRange)) effects.push(addGeneratedRange.of(e.value));
  }
  const marks = tr.startState.field(marksField, false);
  if (marks) {
    tr.changes.iterChangedRanges((fromA, toA) => {
      marks.between(fromA, toA, (f, t) => {
        const from = Math.max(f, fromA);
        const to = Math.min(t, toA);
        if (from < to) effects.push(addGeneratedRange.of({ from, to }));
      });
    });
  }
  return effects;
});

export const generatedMarks: typeof marksField = marksField;
export const generatedMarksExtension = [marksField, invertMarks];
