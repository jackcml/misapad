import { Settings } from "../state/settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  [extra: string]: unknown;
}

/** Message list plus any top-level request-body extras (prefill flags). */
export interface RequestFragment {
  messages: ChatMessage[];
  extraBody?: Record<string, unknown>;
}

const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);
const head = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Ask mode: instruct the model to continue the text seamlessly. */
export function buildAskRequest(docBefore: string, settings: Settings): RequestFragment {
  return {
    messages: [
      { role: "system", content: settings.systemPromptAsk },
      { role: "user", content: tail(docBefore, settings.maxContextChars) },
    ],
  };
}

/** Prefill mode: the document goes in as a partial assistant message the
 * model continues verbatim. The flavor decides how "continue, don't restart"
 * is signalled to the server. */
export function buildPrefillRequest(docBefore: string, settings: Settings): RequestFragment {
  const messages: ChatMessage[] = [];
  if (settings.systemPromptPrefill) {
    messages.push({ role: "system", content: settings.systemPromptPrefill });
  }
  if (settings.userPromptPrefill) {
    messages.push({ role: "user", content: settings.userPromptPrefill });
  }
  const assistant: ChatMessage = {
    role: "assistant",
    content: tail(docBefore, settings.maxContextChars),
  };
  let extraBody: Record<string, unknown> | undefined;
  switch (settings.prefillFlavor) {
    case "prefix-field": // DeepSeek beta, Mistral
      assistant.prefix = true;
      break;
    case "vllm": // vLLM, TabbyAPI, some llama.cpp builds
      extraBody = { continue_final_message: true, add_generation_prompt: false };
      break;
    case "raw": // rely on server semantics for a trailing assistant message
      break;
  }
  messages.push(assistant);
  return { messages, extraBody };
}

/** Popup mode: whole document with an insertion marker (or a REWRITE-wrapped
 * selection) plus a free-form instruction. */
export function buildPopupRequest(
  docBefore: string,
  selected: string,
  docAfter: string,
  instruction: string,
  settings: Settings,
): RequestFragment {
  // Budget: selection is always included whole; before gets 2/3 of the rest,
  // after 1/3, since upstream context usually matters more.
  const budget = Math.max(0, settings.maxContextChars - selected.length);
  const before = tail(docBefore, Math.floor((budget * 2) / 3));
  const after = head(docAfter, budget - before.length);
  const embedded = selected
    ? `${before}<REWRITE>${selected}</REWRITE>${after}`
    : `${before}<INSERT_HERE/>${after}`;
  return {
    messages: [
      { role: "system", content: settings.systemPromptPopup },
      { role: "user", content: `<document>\n${embedded}\n</document>\n\nInstruction: ${instruction}` },
    ],
  };
}
