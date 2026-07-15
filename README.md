# misapad

A minimal frontend for pair-writing with LLMs, inspired by [Mikupad](https://github.com/lmg-anon/mikupad) — but built for **chat-completion** models.

One big text buffer holds both your writing and the model's. Write a paragraph, hit `Ctrl+Enter` to have the model continue, edit the result, keep writing, continue again. Model-generated text is tinted until you're done with it; one `Ctrl+Z` removes a whole generation.

## Quickstart

```sh
npm install
npm run dev          # http://localhost:5173
```

Open settings (⚙), set a base URL, API key, and model, then write and hit `Ctrl+Enter`.

No backend: the browser calls your provider directly and everything (documents, settings, API key) lives in localStorage.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl+Enter` | Continue from the cursor (ask or prefill mode, per settings) |
| `Ctrl+K` | Inline instruction popup — output inserts at the cursor, or rewrites the selection |
| `Esc` | Stop a running generation / close the popup |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo/redo — a whole generation is one undo unit |

## Continue modes

Chat models can't do raw text completion, so misapad offers two ways to fake it well:

- **ask** — wraps your document in a "continue this text seamlessly, output only the continuation" instruction. Works with every chat model; quality depends on how well the model follows instructions.
- **prefill** — sends your document as a partial *assistant* message the model continues verbatim. Where supported this is the closest thing to true text completion. Flavors:
  - `prefix: true` on the trailing assistant message — DeepSeek (base URL `https://api.deepseek.com/beta`) and Mistral.
  - `continue_final_message: true` — vLLM, TabbyAPI.
  - raw trailing assistant message — servers that continue it implicitly.

The `Ctrl+K` popup sends the whole document (budgeted) with an `<INSERT_HERE/>` marker at your cursor — or your selection wrapped in `<REWRITE>` tags — plus your instruction, and strips echoed context from the reply.

## Providers (CORS)

Calls go straight from the browser, so the provider must allow cross-origin requests:

| Provider | Base URL | Notes |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` (`/beta` for prefill) | Works from the browser |
| OpenRouter | `https://openrouter.ai/api/v1` | Works; explicitly supports browser keys |
| OpenAI | `https://api.openai.com/v1` | Works |
| Mistral | `https://api.mistral.ai/v1` | Works, supports `prefix: true` |
| Ollama | `http://localhost:11434/v1` | Localhost origins allowed by default; set `OLLAMA_ORIGINS` for deployed sites |
| llama.cpp `llama-server` | `http://localhost:8080/v1` | Permissive CORS out of the box |
| vLLM | `http://localhost:8000/v1` | Start with `--allowed-origins '["*"]'` |

If a provider blocks browser origins, uncomment the proxy block in `vite.config.ts` and point the base URL at `/api/v1`.

**Security note:** your API key is stored in localStorage and sent from the browser. That's fine for a personal tool; don't deploy a public instance with a shared key.

## Development

```sh
npm test             # unit + headless end-to-end tests (no tokens burned)
npm run mock         # canned SSE server on http://localhost:11435/v1 — any model name works;
                     # ?delay=900 for slow tokens, API key "fail-auth" for the error path
npm run build        # static site in dist/
```

With the dev server and mock server both running, `node tools/e2e.mjs` drives a headless
Chromium through the whole workflow (continue, undo/redo, cancel, popup, error toast,
autosave, sessions) and prints PASS/FAIL per step. It needs a Chromium for Playwright
(`npx playwright install chromium`, or point `CHROME_BIN` at one) and it clears the app's
localStorage on :5173, so don't aim it at a profile with real writing.
