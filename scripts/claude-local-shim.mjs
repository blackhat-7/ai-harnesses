// Rewrites Claude Code's requests on the way to a local model server:
//
//   - Claude Code appends a trailing `role: "system"` message (hook and environment
//     context) to every request. Strict chat templates (Qwen and friends, rendered
//     by llama.cpp) reject a system message that is not first with HTTP 500, which
//     Claude Code retries silently until the session looks hung. Those messages are
//     hoisted into the top-level `system` field.
//   - Model names come back from the display names in CLAUDE_LOCAL_MODELS to the
//     ids the server actually serves.
//   - With CLAUDE_LOCAL_HELPER_MODEL set (a Claude model), requests for Claude
//     models and WebSearch go to Anthropic with the claude.ai login; see
//     cloudRequest. Without it the shim answers WebSearch itself from Exa's
//     search; see webSearchQuery.
//
// Usage: claude-local-shim.mjs <upstream-base-url> <command> [args...]
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { spawn } from "node:child_process";

const anthropic = new URL("https://api.anthropic.com");
// Exa's hosted search answers without an API key, rate limited; Pi's web search uses it too.
const exa = "https://mcp.exa.ai/mcp?tools=web_search_exa";

const asBlocks = (content) =>
  typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);

// llama.cpp reads any schema object holding a "$ref" key as a reference, so a
// tool with a property literally named "$ref" (SigNoz's MCP tools have one)
// fails the whole request with "type must be string, but is object". Drop the
// property; the rest of the tool still works.
function dropRefProperties(node) {
  // No short-circuiting: every tool has to be visited, not just the first hit.
  if (Array.isArray(node)) return node.reduce((found, item) => dropRefProperties(item) || found, false);
  if (!node || typeof node !== "object") return false;

  let dropped = false;
  const properties = node.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties) && "$ref" in properties) {
    delete properties["$ref"];
    if (Array.isArray(node.required)) node.required = node.required.filter((name) => name !== "$ref");
    dropped = true;
  }
  return Object.values(node).reduce((found, value) => dropRefProperties(value) || found, dropped);
}

export function rewriteRequest(body, models = {}) {
  const request = JSON.parse(body);
  let changed = false;

  if (Array.isArray(request.tools) && dropRefProperties(request.tools)) {
    changed = true;
  }

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

// The body to send to Anthropic instead of the local server, or null. Only with a
// helper model: Claude Code's Haiku role then names a Claude model, and WebSearch,
// which it sends to the main model with Anthropic's server-side search tool,
// moves to the helper, because a local server cannot run that tool.
export function cloudRequest(body, helper) {
  if (!helper) return null;
  const request = JSON.parse(body);
  if (String(request.model).startsWith("claude-")) return body;
  if (request.tools?.some((tool) => String(tool.type).startsWith("web_search"))) {
    return JSON.stringify({ ...request, model: helper });
  }
  return null;
}

// The query of a WebSearch request, with its domain filters as site: terms, or
// null for any other request. Claude Code sends WebSearch to the main model as
// "Perform a web search for the query: ..." with Anthropic's server-side
// web_search tool, which a local server cannot run.
export function webSearchQuery(body) {
  const request = JSON.parse(body);
  const tool = request.tools?.find((tool) => String(tool.type).startsWith("web_search"));
  if (!tool) return null;
  const text = asBlocks(request.messages?.[0]?.content).find((block) => block.type === "text")?.text ?? "";
  return [
    text.replace("Perform a web search for the query: ", ""),
    ...(tool.allowed_domains ?? []).map((domain) => `site:${domain}`),
    ...(tool.blocked_domains ?? []).map((domain) => `-site:${domain}`),
  ].join(" ");
}

// Exa's results as text: title, URL, date and highlights for each page, each
// page cut to 1,200 characters to keep a search near 2.5k tokens of context.
async function searchExa(query) {
  try {
    const response = await fetch(exa, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "web_search_exa", arguments: { query, numResults: 8 } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) return `Web search failed: Exa answered HTTP ${response.status}: ${body.slice(0, 300)}`;
    const data = body.split("\n").find((line) => line.startsWith("data:"));
    const { result, error } = JSON.parse(data ? data.slice(5) : body);
    const text = result?.content?.find((block) => block.type === "text")?.text;
    if (!text) return `Web search failed: ${error?.message ?? "Exa returned no results"}`;
    return text
      .split(/\n(?=Title: )/)
      .map((page) => page.slice(0, 1200))
      .join("\n");
  } catch (error) {
    return `Web search failed: ${error.message}`;
  }
}

// An Anthropic message holding only `text`, as server-sent events when the
// request streams.
export function textMessage(request, text) {
  const message = { id: "msg_claude_local", type: "message", role: "assistant", model: request.model, content: [] };
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (!request.stream) {
    const done = { ...message, content: [{ type: "text", text }], stop_reason: "end_turn", usage };
    return { type: "application/json", body: JSON.stringify(done) };
  }
  const events = [
    { type: "message_start", message: { ...message, stop_reason: null, usage } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } },
    { type: "message_stop" },
  ];
  return { type: "text/event-stream", body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("") };
}

export const failureLog = `${os.tmpdir()}/claude-local-error.json`;

function saveFailure(request, response) {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", () => {
    const error = Buffer.concat(chunks).toString();
    const report = { status: response.statusCode, error, request: request.toString() };
    fs.writeFile(failureLog, JSON.stringify(report, null, 2), () => {});
  });
}

// Claude Code sends the claude.ai login token (it keeps the login for connectors);
// only Anthropic gets it, so it never reaches a model server.
export function forwardHeaders(headers, target, body) {
  const { authorization, "x-api-key": apiKey, ...rest } = headers;
  const kept = target.host === anthropic.host ? headers : rest;
  return { ...kept, host: target.host, "content-length": body.length };
}

function start(upstream, command) {
  const models = JSON.parse(process.env.CLAUDE_LOCAL_MODELS ?? "{}");
  const helper = process.env.CLAUDE_LOCAL_HELPER_MODEL;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      let body = Buffer.concat(chunks);
      let target = upstream;
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        try {
          const cloud = cloudRequest(body.toString(), helper);
          const query = cloud || req.url.split("?")[0] !== "/v1/messages" ? null : webSearchQuery(body.toString());
          if (query !== null) {
            const reply = textMessage(JSON.parse(body), await searchExa(query));
            res.writeHead(200, { "content-type": reply.type });
            res.end(reply.body);
            return;
          }
          if (cloud) target = anthropic;
          body = Buffer.from(cloud ?? rewriteRequest(body.toString(), models));
        } catch {} // Not JSON we understand: forward it as received.
      }
      const forwarded = (target.protocol === "https:" ? https : http).request(
        {
          hostname: target.hostname,
          port: target.port,
          method: req.method,
          path: target.pathname.replace(/\/$/, "") + req.url,
          headers: forwardHeaders(req.headers, target, body),
        },
        (response) => {
          // Claude Code hides server errors behind silent retries, so keep the
          // request that caused one; it is the only way to debug a local server.
          if ((response.statusCode ?? 0) >= 400) saveFailure(body, response);
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
