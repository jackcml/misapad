/** Incremental SSE parser for OpenAI-style streams. Pure and stateless:
 * feed it the accumulated buffer, get back complete `data:` payloads and the
 * unconsumed remainder (a partial event still waiting for its blank line). */
export function extractSseData(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  // Events are separated by a blank line; tolerate \r\n.
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const dataLines: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        // Strip a single optional space after the colon, per the SSE spec.
        dataLines.push(line.slice(line[5] === " " ? 6 : 5));
      }
      // Anything else (`: keepalive` comments, `event:` lines) is ignored.
    }
    if (dataLines.length) events.push(dataLines.join("\n"));
  }
  return { events, rest };
}

/** Pull the text delta out of one parsed chat-completion chunk.
 * Returns "" for role-only chunks, usage-only chunks (empty `choices`),
 * and reasoning deltas. */
export function deltaFromChunk(json: unknown): string {
  const chunk = json as { choices?: Array<{ delta?: { content?: string | null } }> };
  return chunk.choices?.[0]?.delta?.content ?? "";
}
