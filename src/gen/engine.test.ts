import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { redo, undo } from "@codemirror/commands";
import { mockView } from "../testing/mockView";
import { updateSettings } from "../state/settings";
import { cancelGeneration, replaceLastGeneration, startGeneration } from "./engine";
import { generatedMarks } from "../editor/generatedMarks";

/** Tiny in-test SSE server. Routes by the request's `model` field:
 *  "ok"      → streams three chunks then [DONE]
 *  "forever" → streams chunks every 20ms until the client disconnects
 *  "delayed" → waits before streaming (for pre-token cancellation)
 *  "fail"    → 401 */
let server: http.Server;
let lastBody: any;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      if (lastBody.model === "fail") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "bad key" } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (content: string) =>
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      if (lastBody.model === "forever") {
        send("tick");
        const timer = setInterval(() => send(" tick"), 20);
        res.on("close", () => clearInterval(timer));
      } else if (lastBody.model === "delayed") {
        const timer = setTimeout(() => {
          send(" late");
          res.write("data: [DONE]\n\n");
          res.end();
        }, 500);
        res.on("close", () => clearTimeout(timer));
      } else {
        const output =
          lastBody.model === "option-a"
            ? " option A"
            : lastBody.model === "option-b"
              ? " option B"
              : lastBody.model === "option-c"
                ? " option C"
                : " there was more.";
        for (const chunk of output.split(/(?= )/)) send(chunk);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  updateSettings({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "", mode: "ask" });
});

afterAll(() => server.close());

describe("engine end-to-end (real HTTP + SSE)", () => {
  it("streams an ask-mode continuation into the doc as one undo unit", async () => {
    updateSettings({ model: "ok" });
    const view = mockView("Once upon a time");
    await startGeneration(view, "continue");
    expect(view.state.doc.toString()).toBe("Once upon a time there was more.");
    expect(lastBody.messages.at(-1)).toEqual({ role: "user", content: "Once upon a time" });
    expect(lastBody.stream).toBe(true);
    undo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time");
  });

  it("keeps rerolled options in undo/redo history", async () => {
    updateSettings({ model: "option-a", mode: "ask" });
    const view = mockView("Once upon a time");
    await startGeneration(view, "continue");
    expect(view.state.doc.toString()).toBe("Once upon a time option A");

    updateSettings({ model: "option-b" });
    expect(await replaceLastGeneration(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Once upon a time option B");
    expect(lastBody.messages.at(-1)).toEqual({ role: "user", content: "Once upon a time" });

    updateSettings({ model: "option-c" });
    expect(await replaceLastGeneration(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Once upon a time option C");

    undo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time option B");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time option A");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time");

    redo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time option A");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time option B");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("Once upon a time option C");

    undo(view as any);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " chosen" },
      userEvent: "input.type",
    });
    expect(redo(view as any)).toBe(false);
    expect(await replaceLastGeneration(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("Once upon a time option B chosen");
  });

  it("does nothing when there is no generation to replace", async () => {
    const view = mockView("untouched");
    view.dispatch({ changes: { from: 9, insert: " typing" }, userEvent: "input.type" });
    expect(await replaceLastGeneration(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("untouched typing");
  });

  it("does not undo user edits made after a generation", async () => {
    updateSettings({ model: "ok", mode: "ask" });
    const view = mockView("seed");
    await startGeneration(view, "continue");
    view.dispatch({ changes: { from: view.state.doc.length, insert: " mine" }, userEvent: "input.type" });

    expect(await replaceLastGeneration(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("seed there was more. mine");

    // Undoing the later edit reveals the generation as the top history event
    // again, so it becomes replaceable without relying on document identity.
    undo(view as any);
    expect(await replaceLastGeneration(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("seed there was more.");
  });

  it("replaces a generation after undo and redo", async () => {
    updateSettings({ model: "ok", mode: "ask" });
    const view = mockView("seed");
    await startGeneration(view, "continue");
    undo(view as any);
    redo(view as any);

    expect(await replaceLastGeneration(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("seed there was more.");
  });

  it("sends the prefill shape when mode is prefill", async () => {
    updateSettings({ model: "ok", mode: "prefill", prefillFlavor: "prefix-field" });
    const view = mockView("The door creaked");
    await startGeneration(view, "continue");
    expect(lastBody.messages.at(-1)).toEqual({
      role: "assistant",
      content: "The door creaked",
      prefix: true,
    });
    updateSettings({ mode: "ask" });
  });

  it("sends vllm continuation flags for that flavor", async () => {
    updateSettings({ model: "ok", mode: "prefill", prefillFlavor: "vllm" });
    const view = mockView("abc");
    await startGeneration(view, "continue");
    expect(lastBody.continue_final_message).toBe(true);
    expect(lastBody.add_generation_prompt).toBe(false);
    updateSettings({ mode: "ask" });
  });

  it("cancels cleanly, keeping partial text as one undo unit", async () => {
    updateSettings({ model: "forever" });
    const view = mockView("start:");
    const done = startGeneration(view, "continue");
    await new Promise((r) => setTimeout(r, 100));
    expect(cancelGeneration()).toBe(true);
    await done;
    const doc = view.state.doc.toString();
    expect(doc.startsWith("start:tick")).toBe(true);
    undo(view as any);
    expect(view.state.doc.toString()).toBe("start:");
  });

  it("cancels and replaces an in-flight generation", async () => {
    updateSettings({ model: "forever", mode: "ask" });
    const view = mockView("start:");
    const first = startGeneration(view, "continue");
    await new Promise((r) => setTimeout(r, 100));

    updateSettings({ model: "ok" });
    expect(await replaceLastGeneration(view)).toBe(true);
    await first;
    expect(view.state.doc.toString()).toBe("start: there was more.");

    undo(view as any);
    expect(view.state.doc.toString()).toMatch(/^start:tick/);
    undo(view as any);
    expect(view.state.doc.toString()).toBe("start:");
  });

  it("supersedes an in-flight reroll when reroll is pressed again", async () => {
    updateSettings({ model: "option-a", mode: "ask" });
    const view = mockView("seed");
    await startGeneration(view, "continue");

    updateSettings({ model: "forever" });
    const firstReroll = replaceLastGeneration(view);
    await new Promise((r) => setTimeout(r, 100));

    updateSettings({ model: "option-c" });
    const secondReroll = replaceLastGeneration(view);
    expect(await firstReroll).toBe(false);
    expect(await secondReroll).toBe(true);
    expect(view.state.doc.toString()).toBe("seed option C");

    undo(view as any);
    expect(view.state.doc.toString()).toBe("seed option A");
  });

  it("overwrites user text entered inside an in-flight generation", async () => {
    updateSettings({ model: "forever", mode: "ask" });
    const view = mockView("seed");
    const first = startGeneration(view, "continue");
    await new Promise((r) => setTimeout(r, 100));
    view.dispatch({ changes: { from: 5, insert: "MINE" }, userEvent: "input.type" });

    updateSettings({ model: "ok" });
    expect(await replaceLastGeneration(view)).toBe(true);
    await first;
    expect(view.state.doc.toString()).toBe("seed there was more.");
    expect(view.state.doc.toString()).not.toContain("MINE");
  });

  it("remains replaceable when an earlier edit is undone mid-stream", async () => {
    updateSettings({ model: "forever", mode: "ask" });
    const view = mockView("seed");
    view.dispatch({ changes: { from: 4, insert: "X" }, userEvent: "input.type" });
    const first = startGeneration(view, "continue");
    await new Promise((r) => setTimeout(r, 100));
    undo(view as any);

    updateSettings({ model: "ok" });
    expect(await replaceLastGeneration(view)).toBe(true);
    await first;
    expect(view.state.doc.toString()).toBe("seed there was more.");
    expect(lastBody.messages.at(-1)).toEqual({ role: "user", content: "seed" });
  });

  it("lets Escape stop a replacement while cancellation is settling", async () => {
    updateSettings({ model: "forever", mode: "ask" });
    const view = mockView("seed");
    const first = startGeneration(view, "continue");
    await new Promise((r) => setTimeout(r, 100));

    updateSettings({ model: "ok" });
    const replacing = replaceLastGeneration(view);
    expect(cancelGeneration()).toBe(true);
    expect(await replacing).toBe(false);
    await first;
    expect(view.state.doc.toString()).toMatch(/^seedtick/);
    expect(view.state.doc.toString()).not.toContain(" there was more.");
  });

  it("surfaces HTTP errors without corrupting the doc", async () => {
    updateSettings({ model: "fail" });
    const view = mockView("safe");
    await startGeneration(view, "continue");
    expect(view.state.doc.toString()).toBe("safe");
  });

  it("popup mode replaces the selection and sends REWRITE context", async () => {
    updateSettings({ model: "ok" });
    const view = mockView("The quick brown fox");
    view.dispatch({ selection: { anchor: 4, head: 9 } }); // select "quick"
    await startGeneration(view, "popup", { instruction: "make it slow" });
    expect(view.state.doc.toString()).toBe("The  there was more. brown fox");
    expect(lastBody.messages[1].content).toContain("<REWRITE>quick</REWRITE>");
    expect(lastBody.messages[1].content).toContain("Instruction: make it slow");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("The quick brown fox");
    const marks: Array<[number, number]> = [];
    view.state.field(generatedMarks).between(0, view.state.doc.length, (f, t) => {
      marks.push([f, t]);
    });
    expect(marks).toEqual([]);
  });

  it("replaces a popup rewrite with the same instruction and selection", async () => {
    updateSettings({ model: "option-a", mode: "ask" });
    const view = mockView("The quick brown fox");
    view.dispatch({ selection: { anchor: 9, head: 4 } }); // backward-select "quick"
    await startGeneration(view, "popup", { instruction: "make it formal" });
    expect(view.state.doc.toString()).toBe("The  option A brown fox");

    updateSettings({ model: "option-b" });
    expect(await replaceLastGeneration(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("The  option B brown fox");
    expect(lastBody.messages[1].content).toContain("<REWRITE>quick</REWRITE>");
    expect(lastBody.messages[1].content).toContain("Instruction: make it formal");

    undo(view as any);
    expect(view.state.doc.toString()).toBe("The  option A brown fox");
    undo(view as any);
    expect(view.state.doc.toString()).toBe("The quick brown fox");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("The  option A brown fox");
    redo(view as any);
    expect(view.state.doc.toString()).toBe("The  option B brown fox");
  });

  it("locks in the current option when the user edits during a buffered reroll", async () => {
    updateSettings({ model: "option-a", mode: "ask" });
    const view = mockView("seed");
    await startGeneration(view, "continue");

    updateSettings({ model: "delayed" });
    const replacing = replaceLastGeneration(view);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " mine" },
      userEvent: "input.type",
    });

    expect(await replacing).toBe(true);
    expect(view.state.doc.toString()).toBe("seed option A mine");
    expect(await replaceLastGeneration(view)).toBe(false);
  });

  it("restarts a pre-token popup cancellation with its original rewrite metadata", async () => {
    updateSettings({ model: "delayed", mode: "ask" });
    const view = mockView("The quick brown fox");
    view.dispatch({ selection: { anchor: 4, head: 9 } });
    const first = startGeneration(view, "popup", { instruction: "make it formal" });

    updateSettings({ model: "ok" });
    expect(await replaceLastGeneration(view)).toBe(true);
    await first;
    expect(view.state.doc.toString()).toBe("The  there was more. brown fox");
    expect(lastBody.messages[1].content).toContain("<REWRITE>quick</REWRITE>");
    expect(lastBody.messages[1].content).toContain("Instruction: make it formal");
  });
});
