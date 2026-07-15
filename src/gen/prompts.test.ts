import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, Settings } from "../state/settings";
import { buildAskRequest, buildPopupRequest, buildPrefillRequest } from "./prompts";

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("buildAskRequest", () => {
  it("wraps the doc tail in a system+user pair", () => {
    const { messages, extraBody } = buildAskRequest("Once upon a time", settings());
    expect(messages).toEqual([
      { role: "system", content: DEFAULT_SETTINGS.systemPromptAsk },
      { role: "user", content: "Once upon a time" },
    ]);
    expect(extraBody).toBeUndefined();
  });

  it("budgets context by taking the tail", () => {
    const { messages } = buildAskRequest("a".repeat(50) + "END", settings({ maxContextChars: 10 }));
    expect(messages[1].content).toBe("aaaaaaaEND");
  });
});

describe("buildPrefillRequest", () => {
  it("prefix-field flavor sets prefix on the trailing assistant message", () => {
    const { messages, extraBody } = buildPrefillRequest("The story so far", settings({ prefillFlavor: "prefix-field" }));
    expect(messages).toEqual([
      { role: "user", content: "Continue the following text." },
      { role: "assistant", content: "The story so far", prefix: true },
    ]);
    expect(extraBody).toBeUndefined();
  });

  it("vllm flavor sets top-level continuation flags", () => {
    const { messages, extraBody } = buildPrefillRequest("text", settings({ prefillFlavor: "vllm" }));
    expect(messages.at(-1)).toEqual({ role: "assistant", content: "text" });
    expect(extraBody).toEqual({ continue_final_message: true, add_generation_prompt: false });
  });

  it("raw flavor sends a bare trailing assistant message", () => {
    const { messages, extraBody } = buildPrefillRequest("text", settings({ prefillFlavor: "raw" }));
    expect(messages.at(-1)).toEqual({ role: "assistant", content: "text" });
    expect(extraBody).toBeUndefined();
  });

  it("includes the optional system prompt when set", () => {
    const { messages } = buildPrefillRequest("text", settings({ systemPromptPrefill: "Write darkly." }));
    expect(messages[0]).toEqual({ role: "system", content: "Write darkly." });
  });
});

describe("buildPopupRequest", () => {
  it("embeds an insertion marker when there is no selection", () => {
    const { messages } = buildPopupRequest("before ", "", " after", "add weather", settings());
    expect(messages[1].content).toBe(
      "<document>\nbefore <INSERT_HERE/> after\n</document>\n\nInstruction: add weather",
    );
  });

  it("wraps the selection in REWRITE tags", () => {
    const { messages } = buildPopupRequest("a ", "bold", " c", "make it timid", settings());
    expect(messages[1].content).toContain("a <REWRITE>bold</REWRITE> c");
  });

  it("budgets before/after context around the selection", () => {
    const { messages } = buildPopupRequest(
      "b".repeat(100),
      "sel",
      "a".repeat(100),
      "x",
      settings({ maxContextChars: 30 }),
    );
    const embedded = /<document>\n(.*)\n<\/document>/s.exec(messages[1].content)![1];
    expect(embedded).toBe("b".repeat(18) + "<REWRITE>sel</REWRITE>" + "a".repeat(9));
  });
});
