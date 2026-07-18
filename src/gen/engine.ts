import { Text, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { getSettings } from "../state/settings";
import { createStore } from "../state/store";
import { appendChunk, beginStreamAt, endStream, isStreaming, StreamResult } from "../editor/stream";
import { addGeneratedRange, genStream } from "../editor/generatedMarks";
import {
  GenerationRetry,
  generationRetryState,
  setGenerationRetry,
} from "../editor/generationRetry";
import { streamChatCompletions } from "./client";
import { buildAskRequest, buildPopupRequest, buildPrefillRequest, RequestFragment } from "./prompts";
import { trimEcho } from "./echoTrim";

export type GenStatus =
  | { state: "idle" }
  | { state: "generating" }
  | { state: "error"; message: string };

const statusStore = createStore<GenStatus>({ state: "idle" });
export const useGenStatus = () => statusStore.use();

export function dismissError() {
  if (statusStore.get().state === "error") statusStore.set({ state: "idle" });
}

interface GenerationResult {
  committed: boolean;
  retry: GenerationRetry;
}

interface GenerationPlan {
  retry: GenerationRetry;
  replacingGeneration: boolean;
  previousRetry: GenerationRetry | null;
  from: number;
  to: number;
  before: string;
  after: string;
  /** Rerolls only commit if the option they started from is still untouched. */
  sourceDoc: Text | null;
}

interface ActiveGeneration {
  view: EditorView;
  controller: AbortController;
  plan: GenerationPlan;
  promise: Promise<GenerationResult>;
}

let activeGeneration: ActiveGeneration | null = null;
let pendingReplacement: { canceled: boolean } | null = null;

/** Returns true if there was a generation to cancel. */
export function cancelGeneration(): boolean {
  if (!activeGeneration) return false;
  if (pendingReplacement) pendingReplacement.canceled = true;
  activeGeneration.controller.abort();
  return true;
}

export interface PopupOpts {
  instruction: string;
}

/** Cancel if necessary and replace the current generated option with another.
 * Each replacement is its own history event, so undo/redo walks prior options.
 * User edits incorporated into an active stream are part of that option. */
export async function replaceLastGeneration(view: EditorView): Promise<boolean> {
  if (activeGeneration && activeGeneration.view !== view) return false;
  // A second reroll supersedes the orchestration that is currently waiting on
  // the active request. Its own abort below wakes the older caller, which then
  // exits without starting another request.
  if (pendingReplacement) pendingReplacement.canceled = true;
  const replacement = { canceled: false };
  pendingReplacement = replacement;
  try {
    const active = activeGeneration?.view === view ? activeGeneration : null;
    if (active) {
      // Use the controller directly: cancelGeneration marks this replacement
      // canceled, which is reserved for a subsequent Escape/Stop action.
      active.controller.abort();
      const result = await active.promise;
      if (replacement.canceled) return false;

      // An initial generation with no token has no retry state yet. Re-run it
      // directly from the selection it restored. A canceled buffered reroll,
      // on the other hand, left the previous option and retry state intact.
      if (!result.committed && !active.plan.replacingGeneration) {
        const plan = createInitialRetryPlan(view, result.retry);
        if (!plan) return false;
        await startPlannedGeneration(view, plan);
        return !replacement.canceled;
      }
    }

    const retry = view.state.field(generationRetryState, false);
    if (!retry) return false;
    const plan = createReplacementPlan(view, retry);
    if (!plan) return false;
    await startPlannedGeneration(view, plan);
    return !replacement.canceled;
  } finally {
    if (pendingReplacement === replacement) pendingReplacement = null;
  }
}

/** Kick off a generation streaming into `view`.
 * kind "continue": continue from the cursor using the mode in settings.
 * kind "popup": insert at the cursor / rewrite the selection per instruction. */
export function startGeneration(
  view: EditorView,
  kind: "continue" | "popup",
  opts?: PopupOpts,
): Promise<void> {
  if (activeGeneration || isStreaming(view)) return Promise.resolve();
  return startPlannedGeneration(view, createInitialPlan(view, kind, opts));
}

function startPlannedGeneration(view: EditorView, plan: GenerationPlan): Promise<void> {
  if (activeGeneration || isStreaming(view)) return Promise.resolve();
  const controller = new AbortController();
  const run = runGeneration(view, plan, controller);
  const promise = run.finally(() => {
    if (activeGeneration?.controller === controller) activeGeneration = null;
  });
  activeGeneration = { view, controller, plan, promise };
  return promise.then(() => undefined);
}

function createInitialPlan(
  view: EditorView,
  kind: "continue" | "popup",
  opts?: PopupOpts,
): GenerationPlan {
  const selection = view.state.selection.main;
  const doc = view.state.doc;
  const from = kind === "popup" ? selection.from : selection.head;
  const to = kind === "popup" ? selection.to : selection.head;
  const retry: GenerationRetry = {
    kind,
    ...(kind === "popup" ? { instruction: opts?.instruction ?? "" } : {}),
    from,
    outputTo: to,
    originalText: doc.sliceString(from, to),
    backward: kind === "popup" && selection.anchor > selection.head,
  };
  return {
    retry,
    replacingGeneration: false,
    previousRetry: view.state.field(generationRetryState, false) ?? null,
    from,
    to,
    before: doc.sliceString(0, from),
    after: doc.sliceString(to),
    sourceDoc: null,
  };
}

function createInitialRetryPlan(view: EditorView, retry: GenerationRetry): GenerationPlan | null {
  const from = retry.from;
  const to = from + retry.originalText.length;
  if (from < 0 || to > view.state.doc.length) return null;
  return {
    retry,
    replacingGeneration: false,
    previousRetry: view.state.field(generationRetryState, false) ?? null,
    from,
    to,
    before: view.state.sliceDoc(0, from),
    after: view.state.sliceDoc(to),
    sourceDoc: null,
  };
}

function createReplacementPlan(view: EditorView, retry: GenerationRetry): GenerationPlan | null {
  if (retry.from < 0 || retry.outputTo < retry.from || retry.outputTo > view.state.doc.length) {
    return null;
  }
  return {
    retry,
    replacingGeneration: true,
    previousRetry: retry,
    from: retry.from,
    to: retry.outputTo,
    before: view.state.sliceDoc(0, retry.from),
    after: view.state.sliceDoc(retry.outputTo),
    sourceDoc: view.state.doc,
  };
}

async function runGeneration(
  view: EditorView,
  plan: GenerationPlan,
  controller: AbortController,
): Promise<GenerationResult> {
  const settings = getSettings();
  const { retry } = plan;

  let fragment: RequestFragment;
  if (retry.kind === "popup") {
    fragment = buildPopupRequest(
      plan.before,
      retry.originalText,
      plan.after,
      retry.instruction ?? "",
      settings,
    );
  } else {
    fragment =
      settings.mode === "prefill"
        ? buildPrefillRequest(plan.before, settings)
        : buildAskRequest(plan.before, settings);
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages: fragment.messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    ...fragment.extraBody,
  };

  statusStore.set({ state: "generating" });
  if (plan.replacingGeneration) {
    return runBufferedReplacement(view, plan, body, controller);
  }

  beginStreamAt(view, plan.from, plan.to);
  let streamResult: StreamResult | null = null;
  try {
    let stream: AsyncIterable<string> = streamChatCompletions(
      settings.baseUrl,
      settings.apiKey,
      body,
      controller.signal,
    );
    if (retry.kind === "popup") {
      stream = trimEcho(stream, plan.before.slice(-200), plan.after.slice(0, 200));
    }
    for await (const chunk of stream) {
      appendChunk(view, chunk);
    }
    statusStore.set({ state: "idle" });
  } catch (err) {
    if (isAbortError(err)) {
      statusStore.set({ state: "idle" });
    } else {
      statusStore.set({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    streamResult = endStream(view, (result) => [
      setGenerationRetry.of(mapRetryToStreamResult(retry, result, true)),
    ], () =>
      plan.previousRetry
        ? [setGenerationRetry.of(plan.previousRetry)]
        : [],
    );
  }
  const mappedRetry = streamResult
    ? mapRetryToStreamResult(retry, streamResult, streamResult.committed)
    : retry;
  return {
    committed: streamResult?.committed ?? false,
    retry: mappedRetry,
  };
}

/** Build a reroll without touching the document, then swap it in as one
 * ordinary history event. Streaming replacements through addToHistory:false
 * would map the previous generation out of CodeMirror's history, making the
 * requested A <-> B <-> C undo chain impossible. */
async function runBufferedReplacement(
  view: EditorView,
  plan: GenerationPlan,
  body: Record<string, unknown>,
  controller: AbortController,
): Promise<GenerationResult> {
  let text = "";
  let completed = false;
  try {
    let stream: AsyncIterable<string> = streamChatCompletions(
      getSettings().baseUrl,
      getSettings().apiKey,
      body,
      controller.signal,
    );
    if (plan.retry.kind === "popup") {
      stream = trimEcho(stream, plan.before.slice(-200), plan.after.slice(0, 200));
    }
    for await (const chunk of stream) text += chunk;
    completed = !controller.signal.aborted;
    statusStore.set({ state: "idle" });
  } catch (err) {
    if (isAbortError(err)) {
      statusStore.set({ state: "idle" });
    } else {
      statusStore.set({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Typing while the request was pending locks in the current option and
  // clears its retry metadata. Never apply a response over that newer state.
  const oldText = plan.sourceDoc?.sliceString(plan.from, plan.to) ?? "";
  if (!completed || view.state.doc !== plan.sourceDoc || text === "" || text === oldText) {
    return {
      committed: false,
      retry: plan.retry,
    };
  }

  const nextRetry: GenerationRetry = {
    ...plan.retry,
    outputTo: plan.from + text.length,
  };
  const selection = view.state.selection.main;
  const selectionWasInside = selection.from >= plan.from && selection.to <= plan.to;
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: text },
    effects: [
      addGeneratedRange.of({ from: plan.from, to: plan.from + text.length }),
      setGenerationRetry.of(nextRetry),
    ],
    annotations: [
      genStream.of(true),
      Transaction.userEvent.of("input.generate"),
      isolateHistory.of("full"),
    ],
    ...(selectionWasInside ? { selection: { anchor: plan.from + text.length } } : {}),
  });
  return { committed: true, retry: nextRetry };
}

function mapRetryToStreamResult(
  retry: GenerationRetry,
  result: StreamResult,
  useGeneratedText: boolean,
): GenerationRetry {
  return {
    ...retry,
    from: result.from,
    outputTo:
      result.from + (useGeneratedText ? result.generatedLength : result.replacedLength),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}
