import { Annotation, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";

/** Tags transactions produced by the generation stream itself (chunk inserts
 * and the end-of-stream swap). Lives here rather than stream.ts so the marks
 * field can consult it without a circular import. */
export const genStream = Annotation.define<boolean>();

/** Marks ranges of model-generated text so they render with a subtle tint.
 * Positions in the effects refer to the transaction's new document.
 *
 * The map functions must tolerate foreign coordinate frames: undo history
 * stores inverted effects and maps them through later transactions in the
 * event's START-doc frame, while a re-inserted range only exists in the END
 * frame. When a stored effect's positions exceed the mapping's document
 * length, drop the effect (returning undefined) instead of letting mapPos
 * throw "Position N is out of range for changeset of length M". The cost is
 * only cosmetic: a redo reached after unrelated edits may lose its tint. */
const mapRange = (
  { from, to }: { from: number; to: number },
  mapping: { length: number; mapPos: (pos: number) => number },
) =>
  from > mapping.length || to > mapping.length
    ? undefined
    : { from: mapping.mapPos(from), to: mapping.mapPos(to) };

export const addGeneratedRange = StateEffect.define<{ from: number; to: number }>({ map: mapRange });

export const removeGeneratedRange = StateEffect.define<{ from: number; to: number }>({ map: mapRange });

const generatedMark = Decoration.mark({ class: "cm-generated" });

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    // Tint means "the model wrote this": any text inserted by something other
    // than the stream (typing, paste, IME — and history events, whose tint is
    // restored by their own stored effects below) punches an untinted hole in
    // whatever mark it landed inside, splitting the mark around it.
    if (tr.docChanged && tr.annotation(genStream) !== true) {
      const holes: Array<{ from: number; to: number }> = [];
      tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) holes.push({ from: fromB, to: toB });
      });
      for (const hole of holes) {
        const splits: ReturnType<typeof generatedMark.range>[] = [];
        let touched = false;
        deco.between(hole.from, hole.to, (f, t) => {
          if (f < hole.to && t > hole.from) {
            touched = true;
            if (f < hole.from) splits.push(generatedMark.range(f, hole.from));
            if (t > hole.to) splits.push(generatedMark.range(hole.to, t));
          }
        });
        if (touched) {
          deco = deco.update({
            filterFrom: hole.from,
            filterTo: hole.to,
            filter: (f, t) => !(f < hole.to && t > hole.from),
            add: splits,
          });
        }
      }
    }
    const docLen = tr.newDoc.length;
    for (const e of tr.effects) {
      if (e.is(addGeneratedRange)) {
        // Clamp: effects replayed from history can carry positions from a
        // frame the current doc no longer matches.
        const from = Math.min(e.value.from, docLen);
        const to = Math.min(e.value.to, docLen);
        if (to <= from) continue;
        // Undo inversion can produce the same range twice (once from the
        // inverted remove effect, once from the deleted-range scan).
        let dup = false;
        deco.between(from, to, (f, t) => {
          if (f === from && t === to) {
            dup = true;
            return false;
          }
        });
        if (!dup) deco = deco.update({ add: [generatedMark.range(from, to)] });
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
 * add/remove effects, and re-add any marked ranges a change deleted.
 * The coordinate-frame mismatch inherent in stored history effects is
 * handled by mapRange/clamping above, not here. */
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
