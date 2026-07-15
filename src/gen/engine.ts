import { EditorView } from "@codemirror/view";
import { getSettings } from "../state/settings";
import { createStore } from "../state/store";
import { appendChunk, beginStreamAt, endStream, isStreaming } from "../editor/stream";
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

let controller: AbortController | null = null;

/** Returns true if there was a generation to cancel. */
export function cancelGeneration(): boolean {
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface PopupOpts {
  instruction: string;
}

/** Kick off a generation streaming into `view`.
 * kind "continue": continue from the cursor using the mode in settings.
 * kind "popup": insert at the cursor / rewrite the selection per instruction. */
export async function startGeneration(view: EditorView, kind: "continue" | "popup", opts?: PopupOpts) {
  if (isStreaming(view)) return;
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

  controller = new AbortController();
  statusStore.set({ state: "generating" });
  beginStreamAt(view, from, to);
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
    endStream(view);
    controller = null;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}
