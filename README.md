# misapad

A minimal frontend for pair-writing with LLMs, inspired by [Mikupad](https://github.com/lmg-anon/mikupad), but updated for use with chat-completion models.

A single text buffer holds both your writing and the model's. Write a paragraph, hit `Ctrl+Enter` to have the model continue, edit the result, keep writing, continue again.
Model-generated text is tinted, marking who's responsible for what. Bad gens are quickly removed with a `Ctrl+Z`.

## Quickstart

```sh
npm install
npm run dev          # http://localhost:5173
```

Open settings, set a base URL, API key, and model. That's it!

Documents, settings, and API keys are stored in localStorage.

## Keybinds

| Key | Action |
| --- | --- |
| `Ctrl+Enter` | Continue from the cursor (ask or prefill mode, per settings) |
| `Ctrl+Shift+Enter` | Undo the last generation and generate its replacement |
| `Ctrl+K` | Inline instruction popup: insert at the cursor or rewrite a selection |
| `Esc` | Stop a running generation or close popup |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo/redo generations |

On touch devices, the same actions live in a floating bar above the keyboard (undo, redo, continue/stop, reroll, instruct).
Desktop remains the primary/recommended platform.

## Continue modes

While chat models can't do raw text completion natively, misapad offers two ways to approximate it:

- **ask** mode prompts the model to continue your text and output just the completion. Works with every chat model. Quality depends on instruction-following.
- **prefill** mode sends your document as a partial assistant message the model continues verbatim. Where supported, this is the closest thing to true text completion. Flavors:
  - `prefix: true` on the trailing assistant message: DeepSeek (base URL `https://api.deepseek.com/beta`) and Mistral.
  - `continue_final_message: true`: vLLM, TabbyAPI.
  - raw trailing assistant message: OpenRouter and other servers that continue it implicitly.

The `Ctrl+K` popup sends the whole document (budgeted) with an `<INSERT_HERE/>` marker at your cursor, or your selection wrapped in `<REWRITE>` tags, plus your instruction, and strips echoed context from the reply.

## Providers (CORS)

Since calls come straight from the browser, the provider must allow cross-origin requests.
Most endpoints do by default, but vLLM may need `--allowed-origins '["*"]'`.

If a provider does block browser origins, uncomment the proxy block in `vite.config.ts` and point the base URL at `/api/v1`.

## Development

```sh
npm test             # unit + headless end-to-end tests (no inference)
npm run mock         # canned SSE server on http://localhost:11435/v1 — any model name works;
                     # ?delay=900 for slow tokens, API key "fail-auth" for the error path
npm run build        # static site in dist/
```

With the dev server and mock server both running, `node tools/e2e.mjs` drives a headless
Chromium through the whole workflow (continue, undo/redo, cancel, popup, error toast,
autosave, sessions) and prints PASS/FAIL per step. It needs a Chromium for Playwright
(`npx playwright install chromium`, or point `CHROME_BIN` at one) and it clears the app's
localStorage on :5173, so don't aim it at a profile with real writing.
