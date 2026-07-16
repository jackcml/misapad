import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { getSettings } from "../state/settings";
import { createStore } from "../state/store";
import { appendChunk, beginStreamAt, endStream, isStreaming, StreamResult } from "../editor/stream";
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

interface ActiveGeneration {
  view: EditorView;
  controller: AbortController;
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

/** Cancel if necessary, undo the most recent generation, and rerun the same
 * kind of request with its original popup instruction and selection. User
 * edits incorporated into an active stream are part of the overwritten unit. */
export async function replaceLastGeneration(view: EditorView): Promise<boolean> {
  if (pendingReplacement) return false;
  const replacement = { canceled: false };
  pendingReplacement = replacement;
  try {
    if (isStreaming(view)) {
      const active = activeGeneration?.view === view ? activeGeneration : null;
      if (!active) return false;
      // Use the controller directly: cancelGeneration marks this replacement
      // canceled, which is reserved for a subsequent Escape/Stop action.
      active.controller.abort();
      const result = await active.promise;
      if (replacement.canceled) return false;

      // No token arrived, so there is no history event to undo. Re-run the
      // canceled request directly with its original selection and metadata.
      if (!result.committed) {
        restoreRetrySelection(view, result.retry);
        await startRetry(view, result.retry);
        return !replacement.canceled;
      }
    }

    const retry = view.state.field(generationRetryState, false);
    if (!retry || !undo(view)) return false;
    restoreRetrySelection(view, retry);
    await startRetry(view, retry);
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
  const selection = view.state.selection.main;
  const retry: GenerationRetry = {
    kind,
    ...(kind === "popup" ? { instruction: opts?.instruction ?? "" } : {}),
    from: selection.from,
    to: selection.to,
    backward: selection.anchor > selection.head,
  };
  const controller = new AbortController();
  const run = runGeneration(view, kind, opts, controller, retry);
  const promise = run.finally(() => {
    if (activeGeneration?.controller === controller) activeGeneration = null;
  });
  activeGeneration = { view, controller, promise };
  return promise.then(() => undefined);
}

async function runGeneration(
  view: EditorView,
  kind: "continue" | "popup",
  opts: PopupOpts | undefined,
  controller: AbortController,
  retry: GenerationRetry,
): Promise<GenerationResult> {
  const settings = getSettings();
  const sel = view.state.selection.main;
  const doc = view.state.doc;

  let fragment: RequestFragment;
  let from: number;
  let to: number;
  if (kind === "popup") {
    from = sel.from;
    to = sel.to;
    fragment = buildPopupRequest(
      doc.sliceString(0, from),
      doc.sliceString(from, to),
      doc.sliceString(to),
      opts?.instruction ?? "",
      settings,
    );
  } else {
    from = to = sel.head;
    const before = doc.sliceString(0, from);
    fragment =
      settings.mode === "prefill"
        ? buildPrefillRequest(before, settings)
        : buildAskRequest(before, settings);
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages: fragment.messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    ...fragment.extraBody,
  };

  statusStore.set({ state: "generating" });
  beginStreamAt(view, from, to);
  let streamResult: StreamResult | null = null;
  try {
    let stream: AsyncIterable<string> = streamChatCompletions(
      settings.baseUrl,
      settings.apiKey,
      body,
      controller.signal,
    );
    if (kind === "popup") {
      stream = trimEcho(stream, doc.sliceString(Math.max(0, from - 200), from), doc.sliceString(to, to + 200));
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
      setGenerationRetry.of(mapRetryToStreamResult(retry, result)),
    ]);
  }
  if (streamResult) retry = mapRetryToStreamResult(retry, streamResult);
  return { committed: streamResult?.committed ?? false, retry };
}

function mapRetryToStreamResult(retry: GenerationRetry, result: StreamResult): GenerationRetry {
  return {
    ...retry,
    from: result.from,
    to: result.from + result.replacedLength,
  };
}

function restoreRetrySelection(view: EditorView, retry: GenerationRetry) {
  const length = view.state.doc.length;
  const from = Math.max(0, Math.min(retry.from, length));
  const to = Math.max(from, Math.min(retry.to, length));
  view.dispatch({
    selection: retry.backward ? { anchor: to, head: from } : { anchor: from, head: to },
  });
}

function startRetry(view: EditorView, retry: GenerationRetry): Promise<void> {
  return startGeneration(
    view,
    retry.kind,
    retry.kind === "popup" ? { instruction: retry.instruction ?? "" } : undefined,
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}
