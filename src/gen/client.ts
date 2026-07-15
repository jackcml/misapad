import { deltaFromChunk, extractSseData } from "./sse";

/** POST an OpenAI-compatible /chat/completions request and yield text deltas.
 * Hand-rolled instead of the openai SDK: we need nonstandard prefill fields
 * (`prefix`, `continue_final_message`) and the raw error bodies that local
 * servers return. */
export async function* streamChatCompletions(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${truncate(text, 400)}` : ""}`);
  }
  if (!res.body) throw new Error("Response has no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = extractSseData(buf);
      buf = rest;
      for (const data of events) {
        if (data === "[DONE]") return;
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // tolerate malformed keepalive-ish payloads
        }
        const delta = deltaFromChunk(json);
        if (delta) yield delta;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
