// Dev-only mock of an OpenAI-compatible /chat/completions SSE endpoint.
// Usage: npm run mock   → http://localhost:11435/v1
// Query params: ?delay=<ms between chunks> (default 50)
// Send Authorization: Bearer fail-auth to exercise the 401 error path.
import http from "node:http";

const PORT = 11435;
const REPLY =
  "and so the story continued, one careful word after another, until the " +
  "mock server ran out of canned text to send.";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
    return res.writeHead(404).end("not found");
  }
  if (req.headers.authorization === "Bearer fail-auth") {
    return res
      .writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { message: "Incorrect API key provided" } }));
  }

  let bodyText = "";
  req.on("data", (c) => (bodyText += c));
  req.on("end", () => {
    const body = JSON.parse(bodyText || "{}");
    console.log("--- request body ---");
    console.dir(body, { depth: null });

    const delay = Number(url.searchParams.get("delay") ?? 50);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(`: keepalive\n\n`);

    const words = REPLY.split(" ");
    let i = 0;
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const timer = setInterval(() => {
      if (res.writableEnded) return clearInterval(timer);
      if (i < words.length) {
        send({ choices: [{ delta: { content: (i === 0 ? "" : " ") + words[i++] } }] });
      } else {
        send({ choices: [], usage: { total_tokens: words.length } });
        res.write("data: [DONE]\n\n");
        res.end();
        clearInterval(timer);
      }
    }, delay);
    req.on("close", () => clearInterval(timer));
  });
});

server.listen(PORT, () => {
  console.log(`mock chat-completions server on http://localhost:${PORT}/v1 (use ?delay=900 for slow tokens)`);
});
