import { describe, expect, it } from "vitest";
import { deltaFromChunk, extractSseData } from "./sse";

const chunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe("extractSseData", () => {
  it("parses complete events and keeps the partial remainder", () => {
    const { events, rest } = extractSseData('data: {"a":1}\n\ndata: {"b"');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });

  it("handles events split across reads when re-fed the remainder", () => {
    const full = chunk("Hello") + chunk(" world");
    // Feed in awkward 7-byte slices, carrying the remainder forward.
    let buf = "";
    const events: string[] = [];
    for (let i = 0; i < full.length; i += 7) {
      buf += full.slice(i, i + 7);
      const out = extractSseData(buf);
      events.push(...out.events);
      buf = out.rest;
    }
    expect(events.map((e) => deltaFromChunk(JSON.parse(e)))).toEqual(["Hello", " world"]);
  });

  it("tolerates CRLF line endings", () => {
    const { events } = extractSseData('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n');
    expect(events).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("ignores comment/keepalive and event: lines", () => {
    const { events } = extractSseData(': keepalive\n\nevent: message\ndata: {"a":1}\n\n');
    expect(events).toEqual(['{"a":1}']);
  });

  it("joins multi-line data fields and strips one optional space", () => {
    const { events } = extractSseData("data:line1\ndata: line2\n\n");
    expect(events).toEqual(["line1\nline2"]);
  });
});

describe("deltaFromChunk", () => {
  it("extracts content deltas", () => {
    expect(deltaFromChunk({ choices: [{ delta: { content: "hi" } }] })).toBe("hi");
  });

  it("returns empty for role-only first chunks", () => {
    expect(deltaFromChunk({ choices: [{ delta: { role: "assistant", content: null } }] })).toBe("");
  });

  it("returns empty for the usage chunk with empty choices", () => {
    expect(deltaFromChunk({ choices: [], usage: { total_tokens: 5 } })).toBe("");
  });

  it("ignores reasoning deltas", () => {
    expect(deltaFromChunk({ choices: [{ delta: { reasoning_content: "hmm" } }] })).toBe("");
  });
});
