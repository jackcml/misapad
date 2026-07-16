import { StateEffect, StateField } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

export interface GenerationRetry {
  kind: "continue" | "popup";
  instruction?: string;
  /** Selection to restore after undo, in the pre-generation document. */
  from: number;
  to: number;
  backward: boolean;
}

export const setGenerationRetry = StateEffect.define<GenerationRetry | null>({
  map(value, changes) {
    if (!value) return null;
    // A popup's restored selection may be longer than its generated rewrite,
    // putting `to` outside this mapping's coordinate frame. Keep the retry
    // metadata unchanged rather than throwing; it is interpreted after undo.
    if (value.from > changes.length || value.to > changes.length) return value;
    return {
      ...value,
      from: changes.mapPos(value.from, -1),
      to: changes.mapPos(value.to, 1),
    };
  },
});

export const generationRetryState = StateField.define<GenerationRetry | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGenerationRetry)) return effect.value;
    }
    // Once the user changes a completed generation, replacing it via a single
    // undo is no longer safe. Undo restores this value through invertedEffects.
    return tr.docChanged ? null : value;
  },
});

export const generationRetryExtension = [
  generationRetryState,
  invertedEffects.of((tr) => {
    const previous = tr.startState.field(generationRetryState, false) ?? null;
    const explicitlySet = tr.effects.some((effect) => effect.is(setGenerationRetry));
    return explicitlySet || (tr.docChanged && previous) ? [setGenerationRetry.of(previous)] : [];
  }),
];
