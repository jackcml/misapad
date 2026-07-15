import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { undo } from "@codemirror/commands";
import { mockView } from "../testing/mockView";
import { updateSettings } from "../state/settings";
import { cancelGeneration, startGeneration } from "./engine";
import { generatedMarks } from "../editor/generatedMarks";

/** Tiny in-test SSE server. Routes by the request's `model` field:
 *  "ok"      → streams three chunks then [DONE]
 *  "forever" → streams chunks every 20ms until the client disconnects
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
        req.on("close", () => clearInterval(timer));
      } else {
        send(" there");
        send(" was");
        send(" more.");
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
});
