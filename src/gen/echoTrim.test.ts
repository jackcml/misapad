import { describe, expect, it } from "vitest";
import { trimEcho } from "./echoTrim";

async function* feed(chunks: string[]) {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of gen) out += c;
  return out;
}

describe("trimEcho", () => {
  it("passes clean output through unchanged", async () => {
    const out = await collect(trimEcho(feed(["A gentle ", "rain began ", "to fall."]), "the window. ", "The next day"));
    expect(out).toBe("A gentle rain began to fall.");
  });

  it("strips a leading echo of the preceding text", async () => {
    const before = "He opened the door and stepped inside. ";
    const out = await collect(trimEcho(feed([before, "The room was dark."]), before, ""));
    expect(out).toBe("The room was dark.");
  });

  it("strips a trailing echo of the following text", async () => {
    const after = "Meanwhile, across town, the detective waited.";
    const out = await collect(trimEcho(feed(["It began to snow. ", after]), "", after));
    expect(out).toBe("It began to snow. ");
  });

  it("strips code fences around the output", async () => {
    const out = await collect(trimEcho(feed(["```text\nHello world.\n```"]), "", ""));
    expect(out).toBe("Hello world.");
  });

  it("does not trim short coincidental matches", async () => {
    const out = await collect(trimEcho(feed([" the story"]), "and then the", "")); // 4-char overlap " the"
    expect(out).toBe(" the story");
  });

  it("streams the middle rather than buffering everything", async () => {
    const chunks: string[] = [];
    const long = "x".repeat(500);
    for await (const c of trimEcho(feed([long, "tail"]), "", "")) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(long + "tail");
  });
});
