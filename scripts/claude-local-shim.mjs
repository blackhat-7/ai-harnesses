// Claude Code appends a trailing `role: "system"` message (hook and environment
// context) to every request. Strict chat templates (Qwen and friends, rendered by
// llama.cpp) reject a system message that is not first with HTTP 500, which Claude
// Code retries silently until the session looks hung. Hoist those messages into
// the top-level `system` field and forward everything else untouched.
//
// Usage: claude-local-shim.mjs <upstream-base-url> <command> [args...]
// Delete this once llama.cpp merges system messages itself.
import http from "node:http";
import { spawn } from "node:child_process";

const asBlocks = (content) =>
  typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);

export function hoistSystemMessages(body) {
  const request = JSON.parse(body);
  if (!Array.isArray(request.messages)) return body;
  if (!request.messages.some((message) => message.role === "system")) return body;

  const system = asBlocks(request.system);
  const messages = [];
  for (const message of request.messages) {
    if (message.role !== "system") messages.push(message);
    else system.push(...asBlocks(message.content).filter((block) => block.type === "text"));
  }
  return JSON.stringify({ ...request, system, messages });
}

function start(upstream, command) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        try {
          body = Buffer.from(hoistSystemMessages(body.toString()));
        } catch {} // Not JSON we understand: forward it as received.
      }
      const forwarded = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: upstream.pathname.replace(/\/$/, "") + req.url,
          headers: { ...req.headers, host: upstream.host, "content-length": body.length },
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      forwarded.on("error", (error) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: error.message } }));
      });
      forwarded.end(body);
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    });
    child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
    child.on("error", (error) => {
      console.error(`claude-local: ${error.message}`);
      process.exit(1);
    });
  });
}

// Without arguments the module is only being imported, so nothing is proxied.
const [upstreamUrl, ...command] = process.argv.slice(2);
if (upstreamUrl) start(new URL(upstreamUrl), command);
