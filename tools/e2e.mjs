// Browser end-to-end check. WARNING: clears the app's localStorage at
// http://localhost:5173 — don't run it against a browser profile with real
// writing in it (it drives a throwaway headless Chromium by default, where
// that's a non-issue).
//
// Prerequisites:
//   npm run dev     (app on :5173)
//   npm run mock    (canned SSE server on :11435)
//   npx playwright install chromium   (or set CHROME_BIN)
// Run: node tools/e2e.mjs   — prints PASS/FAIL per step, screenshots in /tmp.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/misapad-e2e";
mkdirSync(SHOT_DIR, { recursive: true });
const executablePath =
  process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN) ? process.env.CHROME_BIN : undefined;

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

let fails = 0;
const step = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

await page.goto("http://localhost:5173");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector(".cm-content", { timeout: 15000 });
step("app renders editor", true);

// Configure provider via the settings panel.
await page.click('button[title="Settings"]');
const baseUrl = page.locator('input[placeholder="http://localhost:11434/v1"]');
await baseUrl.fill("http://localhost:11435/v1");
await page.locator('input[placeholder="deepseek-chat"]').fill("mock-model");
await page.click('button[title="Settings"]'); // close panel

// Type prose and continue with Ctrl+Enter (ask mode).
await page.click(".cm-content");
await page.keyboard.type("Once upon a time the village slept, ");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".status.generating", { timeout: 5000 });
await page.waitForSelector(".status.generating", { state: "detached", timeout: 15000 });
let doc = await page.textContent(".cm-content");
step("ask-mode continuation streamed in", doc.includes("and so the story continued"), JSON.stringify(doc.slice(0, 120)));
const tinted = await page.locator(".cm-generated").count();
step("generated text is tinted", tinted > 0, `${tinted} span(s)`);
await page.screenshot({ path: `${SHOT_DIR}/1-continued.png` });

// One undo removes the whole generation.
await page.keyboard.press("Control+z");
doc = await page.textContent(".cm-content");
step("single undo removes whole generation", doc.trim() === "Once upon a time the village slept,", JSON.stringify(doc));
await page.keyboard.press("Control+y");
doc = await page.textContent(".cm-content");
step("redo (Ctrl+y) restores it", doc.includes("and so the story continued"));
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+Shift+Z");
doc = await page.textContent(".cm-content");
step("redo (Ctrl+Shift+z) restores it", doc.includes("and so the story continued"));
const tintedAfterRedo = await page.locator(".cm-generated").count();
step("redo restores tint", tintedAfterRedo > 0);

// Regression: generate directly after an undo (no redo in between) — stale
// history effects used to throw "Position N is out of range for changeset".
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".status.generating", { timeout: 5000 });
await page.waitForSelector(".status.generating", { state: "detached", timeout: 15000 });
const errAfterUndoGen = await page.locator(".status.error").count();
doc = await page.textContent(".cm-content");
step("generate after undo works", errAfterUndoGen === 0 && doc.includes("and so the story continued"));
await page.keyboard.press("Control+z"); // back to the plain typed text
doc = await page.textContent(".cm-content");

// Ctrl+Shift+Enter mid-stream cancels the partial generation and starts a
// second request whose output replaces it.
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".status.generating", { timeout: 5000 });
await page.waitForTimeout(300);
const replacementRequest = page.waitForRequest(
  (req) => req.method() === "POST" && req.url().includes("/chat/completions"),
  { timeout: 5000 },
);
await page.keyboard.press("Control+Shift+Enter");
await replacementRequest;
await page.waitForSelector(".status.generating", { state: "detached", timeout: 15000 });
const afterMidStreamReplace = await page.textContent(".cm-content");
const continuationCount = afterMidStreamReplace.split("and so the story continued").length - 1;
step(
  "Ctrl+Shift+Enter replaces an in-flight generation",
  continuationCount === 1,
  `${continuationCount} completed continuation(s)`,
);
await page.keyboard.press("Control+z"); // back to the plain typed text
doc = await page.textContent(".cm-content");

// Esc mid-stream cancels and keeps partial text.
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".status.generating", { timeout: 5000 });
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForSelector(".status.generating", { state: "detached", timeout: 5000 });
const afterCancel = await page.textContent(".cm-content");
step("Esc cancels mid-stream", afterCancel.length > doc.length - 5, `len ${doc.length} -> ${afterCancel.length}`);

// Ctrl+K popup: instruction-driven insertion at cursor.
await page.keyboard.press("Control+k");
const popupInput = page.locator(".popup input");
await popupInput.waitFor({ timeout: 5000 });
await page.screenshot({ path: `${SHOT_DIR}/2-popup.png` });
const beforePopup = await page.textContent(".cm-content");
const linesBeforePopup = await page.locator(".cm-line").count();
await popupInput.fill("describe the weather");
await popupInput.press("Enter");
await page.waitForSelector(".status.generating", { timeout: 5000 });
await page.waitForSelector(".status.generating", { state: "detached", timeout: 15000 });
const afterPopup = await page.textContent(".cm-content");
const linesAfterPopup = await page.locator(".cm-line").count();
step(
  "popup generation inserts text without leaking Enter",
  afterPopup.length > beforePopup.length &&
    afterPopup.includes("and so the story continued") &&
    linesAfterPopup === linesBeforePopup,
  `${beforePopup.length} -> ${afterPopup.length} chars, ${linesBeforePopup} -> ${linesAfterPopup} lines`,
);
await page.screenshot({ path: `${SHOT_DIR}/3-after-popup.png` });

// Error surface: bad API key -> visible error toast.
await page.click('button[title="Settings"]');
await page.locator('input[placeholder="(empty for local servers)"]').fill("fail-auth");
await page.click('button[title="Settings"]');
await page.click(".cm-content");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".status.error", { timeout: 5000 });
const errText = await page.textContent(".status.error");
step("HTTP error surfaced in top bar", errText.includes("401"), errText.trim());
await page.screenshot({ path: `${SHOT_DIR}/4-error.png` });
await page.click('button[title="Settings"]');
await page.locator('input[placeholder="(empty for local servers)"]').fill("");
await page.click('button[title="Settings"]');

// Autosave: reload restores the doc and its tint.
const beforeReload = await page.textContent(".cm-content");
const tintBeforeReload = await page.locator(".cm-generated").allTextContents();
await page.waitForTimeout(700); // let the debounced autosave fire
await page.reload();
await page.waitForSelector(".cm-content", { timeout: 15000 });
const afterReload = await page.textContent(".cm-content");
step("doc survives reload (autosave)", afterReload === beforeReload, `len ${beforeReload.length} vs ${afterReload.length}`);
const tintAfterReload = await page.locator(".cm-generated").allTextContents();
step(
  "tint survives reload",
  tintBeforeReload.length > 0 && tintAfterReload.join("|") === tintBeforeReload.join("|"),
  `${tintBeforeReload.length} span(s)`,
);

// Sessions: all CRUD confirmation stays inside the app. A new session gets an
// empty doc, and switching back restores the first session.
await page.click('button[title="New session"]');
const sessionDialog = page.locator('.session-dialog[role="dialog"]');
await sessionDialog.waitFor({ timeout: 5000 });
await sessionDialog.locator("input").fill("second story");
await sessionDialog.getByRole("button", { name: "Create" }).click();
await page.waitForTimeout(200);
const emptyDoc = await page.textContent(".cm-content");
step("new session starts empty", emptyDoc.trim() === "" || emptyDoc.trim() === "Start writing…", JSON.stringify(emptyDoc.slice(0, 40)));
step(
  "new session uses the in-app name",
  (await page.locator(".session-picker select option:checked").textContent()) === "second story",
);

await page.click('button[title="Rename session"]');
await sessionDialog.locator("input").fill("renamed story");
await sessionDialog.locator("input").press("Enter");
step(
  "rename uses the in-app dialog",
  (await page.locator(".session-picker select option:checked").textContent()) === "renamed story",
);

await page.selectOption(".session-picker select", { index: 0 });
await page.waitForTimeout(200);
const backDoc = await page.textContent(".cm-content");
step("switching back restores first doc", backDoc === beforeReload);
const tintAfterSwitch = await page.locator(".cm-generated").allTextContents();
step("switching back restores tint", tintAfterSwitch.join("|") === tintBeforeReload.join("|"));

await page.selectOption(".session-picker select", { label: "renamed story" });
await page.click('button[title="Delete session"]');
step(
  "delete confirmation names the session",
  (await sessionDialog.textContent()).includes("renamed story"),
);
await sessionDialog.getByRole("button", { name: "Delete" }).click();
step(
  "delete uses the in-app confirmation",
  (await page.locator('.session-picker select option').allTextContents()).includes("renamed story") === false,
);

// CodeMirror virtualizes long documents, so browser-native find only sees the
// rendered viewport. The editor's Ctrl+F panel must search the full state.
await page.click('button[title="New session"]');
await sessionDialog.locator("input").fill("search story");
await sessionDialog.locator("input").press("Enter");
await page.click(".cm-content");
const distantNeedle = "DISTANT_SEARCH_NEEDLE";
const longDoc = Array.from({ length: 600 }, (_, i) => `Line ${i}: ordinary filler text.`).join("\n") +
  `\n${distantNeedle}`;
await page.keyboard.insertText(longDoc);
await page.keyboard.press("Control+Home");
await page.keyboard.press("Control+f");
const searchInput = page.locator('.cm-search input[name="search"]');
await searchInput.pressSequentially(distantNeedle);
await searchInput.press("Enter");
await page.screenshot({ path: `${SHOT_DIR}/5-search-panel.png` });
const selectedMatch = page.locator(".cm-searchMatch-selected");
await selectedMatch.waitFor({ timeout: 5000 });
step(
  "Ctrl+F finds text outside the rendered viewport",
  (await selectedMatch.textContent()) === distantNeedle,
);
await searchInput.press("Control+a");
await searchInput.pressSequentially("ordinary");
await page.locator('.cm-search button[name="select"]').click();
const selectionCountText = await page.locator(".cm-selection-count").textContent();
step(
  "search select all creates every match selection",
  selectionCountText?.split(" · ", 1)[0] === "4,800 chars",
  selectionCountText ?? "selection count missing",
);
step(
  "search select all returns focus to the editor",
  await page.locator(".cm-content").evaluate((element) => document.activeElement === element),
);
await page.keyboard.press("Escape");

const realErrors = errors.filter(
  (e) => !e.includes("404") && !e.includes("401"), // favicon + deliberate bad-key test
);
step("no console errors", realErrors.length === 0, realErrors.join(" | ").slice(0, 300));
await browser.close();
process.exitCode = fails ? 1 : 0;
