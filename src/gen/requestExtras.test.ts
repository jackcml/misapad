import { describe, expect, it } from "vitest";
import { parseRequestExtras } from "./requestExtras";

describe("parseRequestExtras", () => {
  it("treats an empty setting as no extras", () => {
    expect(parseRequestExtras("  ", "Ask-mode extra body")).toEqual({});
  });

  it("accepts a top-level JSON object", () => {
    expect(parseRequestExtras('{"reasoning":{"effort":"none"}}', "Ask-mode extra body"))
      .toEqual({ reasoning: { effort: "none" } });
  });

  it("rejects malformed JSON with the setting name", () => {
    expect(() => parseRequestExtras("{", "Ctrl+K extra body"))
      .toThrow(/Ctrl\+K extra body must be valid JSON/);
  });

  it("rejects non-object JSON", () => {
    expect(() => parseRequestExtras("[]", "Ask-mode extra body"))
      .toThrow("Ask-mode extra body must be a JSON object");
  });
});
