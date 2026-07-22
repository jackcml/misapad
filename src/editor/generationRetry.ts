import { StateEffect, StateField } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

export interface GenerationRetry {
  kind: "continue" | "popup";
  instruction?: string;
  /** Start of both the original selection and current generated option. */
  from: number;
  /** End of the generated option currently present in the document. */
  outputTo: number;
  /** Text selected before the first generation (empty for continuation). */
  originalText: string;
}

export const setGenerationRetry = StateEffect.define<GenerationRetry | null>({
  map(value, changes) {
    if (!value) return null;
    if (value.from > changes.length || value.outputTo > changes.length) return value;
    return {
      ...value,
      from: changes.mapPos(value.from, -1),
      outputTo: changes.mapPos(value.outputTo, 1),
    };
  },
});

export const generationRetryState = StateField.define<GenerationRetry | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGenerationRetry)) return effect.value;
    }
    // Once the user changes a completed option, it is no longer eligible for
    // a direct reroll. Undo restores this value through invertedEffects.
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
