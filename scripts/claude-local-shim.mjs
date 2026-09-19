// Rewrites Claude Code's requests on the way to a local model server:
//
//   - Claude Code appends a trailing `role: "system"` message (hook and environment
//     context) to every request. Strict chat templates (Qwen and friends, rendered
//     by llama.cpp) reject a system message that is not first with HTTP 500, which
//     Claude Code retries silently until the session looks hung. Those messages are
//     hoisted into the top-level `system` field.
//   - Model names come back from the display names in CLAUDE_LOCAL_MODELS to the
//     ids the server actually serves.
//
// Usage: claude-local-shim.mjs <upstream-base-url> <command> [args...]
import http from "node:http";
import { spawn } from "node:child_process";

const asBlocks = (content) =>
  typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);

export function rewriteRequest(body, models = {}) {
  const request = JSON.parse(body);
  let changed = false;

  // Claude Code marks a 1M-context selection with a [1m] suffix on the name.
  const id = models[String(request.model).replace(/\[1m\]$/, "")];
  if (id && id !== request.model) {
    request.model = id;
    changed = true;
  }

  if (Array.isArray(request.messages) && request.messages.some((m) => m.role === "system")) {
    const system = asBlocks(request.system);
    const messages = [];
    for (const message of request.messages) {
      if (message.role !== "system") messages.push(message);
      else system.push(...asBlocks(message.content).filter((block) => block.type === "text"));
    }
    Object.assign(request, { system, messages });
    changed = true;
  }

  return changed ? JSON.stringify(request) : body;
}

function start(upstream, command) {
  const models = JSON.parse(process.env.CLAUDE_LOCAL_MODELS ?? "{}");
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        try {
          body = Buffer.from(rewriteRequest(body.toString(), models));
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

// Nothing is proxied when the module is imported rather than run.
if (import.meta.filename === process.argv[1]) {
  const [upstreamUrl, ...command] = process.argv.slice(2);
  start(new URL(upstreamUrl), command);
}
