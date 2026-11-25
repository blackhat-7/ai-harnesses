// Rewrites Claude Code's requests on the way to a local model server:
//
//   - Claude Code sends context as `role: "system"` messages inside the conversation:
//     the environment block after the first prompt, then updates where they happen
//     (a changed working directory, a message queued while it works, the date).
//     Strict chat templates (Qwen and friends, rendered by llama.cpp) reject a
//     system message that is not first with HTTP 500, which Claude Code retries
//     silently until the session looks hung. Each becomes a <system-reminder> in
//     the user turn where it stands, as older Claude Code sent them. Moving them
//     into the top-level `system` instead changed the start of the prompt with
//     every update, and the server re-read the whole conversation.
//   - Model names come back from the display names in CLAUDE_LOCAL_MODELS to the
//     ids the server actually serves.
//   - The text of the file named by CLAUDE_LOCAL_NOTES, which describes this server's
//     limits, goes last in `system` on every agent turn: the main agent's and each
//     subagent's. A flag such as --append-system-prompt reaches only the main agent.
//   - Tools loaded by ToolSearch reach the model at the end of the prompt and are
//     called through one fixed tool; see inlineLoadedTools.
//   - A tool call the server sent back as text, because it names a tool the request
//     does not declare, reaches Claude Code as a call; see parseToolCalls.
//   - With CLAUDE_LOCAL_HELPER_MODEL set (a Claude model), requests for Claude
//     models, WebSearch and auto mode's safety checks go to Anthropic with the
//     claude.ai login; see cloudRequest. Without it the shim answers WebSearch
//     itself from Exa's search; see webSearchQuery.
//
// Usage: claude-local-shim.mjs <upstream-base-url> <command> [args...]
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";

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

// With tool search on, Claude Code declares a tool ToolSearch loads (defer_loading)
// from then on and answers the search with a tool_reference, which the Anthropic
// API expands. A local server renders declared tools at the top of the prompt, so
// each load would make it read the whole conversation again, and it drops the
// reference. Instead the loaded tool's definition replaces the reference, where
// the search returned it, and the model calls it through call_loaded_tool, which
// is always declared. The model's calls are written back to the real tool on the
// way out (unwrapLoadedToolCall) and wrapped again here when sent back as history.
const loadedTool = "call_loaded_tool";
const loadedToolDefinition = {
  name: loadedTool,
  description:
    "Call a tool that ToolSearch loaded. Its name, description and input schema are in the ToolSearch result. " +
    "Pass its exact name and its input as an object.",
  input_schema: {
    type: "object",
    properties: { name: { type: "string" }, input: { type: "object" } },
    required: ["name", "input"],
  },
};

const describeLoadedTool = (name, tool) =>
  tool
    ? `Loaded ${name}. Call it with ${loadedTool} as {"name": "${name}", "input": {...}}.\n` +
      `Description: ${tool.description ?? ""}\nInput schema: ${JSON.stringify(tool.input_schema ?? {})}`
    : `${name} is no longer available.`;

function inlineLoadedTools(request) {
  if (!request.tools?.some((tool) => tool.name === "ToolSearch")) return false;
  const loaded = new Map(request.tools.filter((tool) => tool.defer_loading).map((tool) => [tool.name, tool]));
  request.tools = [...request.tools.filter((tool) => !tool.defer_loading), loadedToolDefinition];
  const declared = new Set(request.tools.map((tool) => tool.name));
  for (const message of request.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use" && !declared.has(block.name)) {
        block.input = { name: block.name, input: block.input };
        block.name = loadedTool;
      } else if (block.type === "tool_result" && Array.isArray(block.content)) {
        block.content = block.content.map((part) =>
          part.type === "tool_reference"
            ? { type: "text", text: describeLoadedTool(part.tool_name, loaded.get(part.tool_name)) }
            : part,
        );
      }
    }
  }
  return true;
}

// The input schema of each tool ToolSearch loaded, by name. The server is not told
// about them, but a call to one that it sends back as text needs it; see parseToolCalls.
const loadedSchemas = (body) =>
  Object.fromEntries(
    (JSON.parse(body).tools ?? []).filter((tool) => tool.defer_loading).map((tool) => [tool.name, tool.input_schema]),
  );

// The model's call_loaded_tool call as the real tool's: {name, input} of a
// tool_use block, or null when the call does not parse. The model sometimes
// wraps a call twice (call_loaded_tool naming call_loaded_tool), so every
// layer comes off.
function unwrapLoadedToolCall(input) {
  try {
    let call = { name: loadedTool, input };
    while (call.name === loadedTool) {
      const args = typeof call.input === "string" ? JSON.parse(call.input || "{}") : call.input;
      const inner = typeof args.input === "string" ? JSON.parse(args.input) : args.input;
      if (typeof args.name !== "string") return null;
      call = { name: args.name, input: inner ?? {} };
    }
    return call;
  } catch {
    return null;
  }
}

// A call the model writes to a tool the request does not declare is one the
// server cannot read: a deferred tool it has not loaded, or a loaded one called
// by its own name instead of through call_loaded_tool. Strata sends such a call
// back as the text the model wrote, which Claude Code would show as the answer,
// ending the turn. The shim makes it the tool_use it is, so Claude Code runs it,
// or answers that the tool must be loaded first and the model goes on.
const callTag = "<tool_call>";

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// The calls `text` consists of, in the XML form Qwen models write, as tool_use
// blocks, or null when it holds anything else. A value stays a string where the
// tool's schema says so, and is read as JSON elsewhere when it parses.
function parseToolCalls(text, schemas = {}) {
  const calls = [];
  const rest = text.replace(
    /<tool_call>\s*<function=([^>\s]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g,
    (_, name, body) => {
      const input = {};
      for (const [, key, value] of body.matchAll(/<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) {
        input[key] = schemas[name]?.properties?.[key]?.type === "string" ? value : parseJson(value);
      }
      calls.push({ type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "")}`, name, input });
      return "";
    },
  );
  return calls.length > 0 && !rest.trim() ? calls : null;
}

// A model server's non-streamed reply with call_loaded_tool calls written back,
// and calls the server sent back at the end of its text made tool_use blocks.
export function unwrapReply(body, schemas = {}) {
  const reply = JSON.parse(body);
  for (const block of reply.content ?? []) {
    const call = block.type === "tool_use" && block.name === loadedTool && unwrapLoadedToolCall(block.input);
    if (call) Object.assign(block, call);
  }
  const last = reply.content?.at(-1);
  const at = last?.type === "text" ? last.text.indexOf(callTag) : -1;
  const calls = at >= 0 && parseToolCalls(last.text.slice(at), schemas);
  if (calls) {
    const text = last.text.slice(0, at);
    reply.content.splice(-1, 1, ...(text.trim() ? [{ ...last, text }] : []), ...calls);
    reply.stop_reason = "tool_use";
  }
  return JSON.stringify(reply);
}

const send = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function readEvent(raw) {
  const data = raw.split("\n").find((line) => line.startsWith("data:"));
  return data ? JSON.parse(data.slice(5)) : null;
}

// A stream of server-sent events, each replaced by what rewrite returns for it;
// finish returns what is still held when the stream ends.
function eventStream(rewrite, finish = () => "") {
  let buffer = "";
  return new Transform({
    transform(chunk, _encoding, done) {
      const events = (buffer + chunk).replace(/\r\n/g, "\n").split("\n\n");
      buffer = events.pop();
      done(null, events.map(rewrite).join(""));
    },
    flush(done) {
      done(null, finish() + buffer);
    },
  });
}

// The same for a streamed reply, in two steps. First a call_loaded_tool block is
// held until it ends, then sent as the real tool's start, its whole input and its stop.
export function unwrapEvents() {
  const held = new Map();
  return eventStream((raw) => {
    if (!raw.includes(loadedTool) && held.size === 0) return `${raw}\n\n`;
    const event = readEvent(raw);
    if (event?.type === "content_block_start" && event.content_block?.name === loadedTool) {
      held.set(event.index, { start: event, json: "" });
      return "";
    }
    const call = held.get(event?.index);
    if (!call) return `${raw}\n\n`;
    if (event.type === "content_block_delta") {
      call.json += event.delta?.partial_json ?? "";
      return "";
    }
    held.delete(event.index);
    const unwrapped = unwrapLoadedToolCall(call.json);
    const block = unwrapped ? { ...call.start.content_block, name: unwrapped.name, input: {} } : call.start.content_block;
    const json = unwrapped ? JSON.stringify(unwrapped.input) : call.json;
    return (
      send({ ...call.start, content_block: block }) +
      send({ type: "content_block_delta", index: event.index, delta: { type: "input_json_delta", partial_json: json } }) +
      `${raw}\n\n`
    );
  });
}

// Then calls the server sent back as text become tool_use blocks. A text block is
// held until it shows more than white space, which may only lead up to a call.
// From a <tool_call> in it on, the reply is held until its message_delta. If the
// rest of the block is calls and no other block follows, they go out after the
// text before them and the reply stops for tool use; otherwise all of it goes out
// as the server sent it.
export function recoverCalls(schemas = {}) {
  let block = null; // the open text block: its index, its start event until sent, its text not yet sent
  let held = null; // the reply's other events after a <tool_call> in that block
  const textDelta = (text) =>
    send({ type: "content_block_delta", index: block.index, delta: { type: "text_delta", text } });
  const release = () => (block.start ?? "") + (block.text ? textDelta(block.text) : "") + (held?.events ?? "");

  function sendCalls(calls, messageDelta) {
    let index = block.index;
    let out = block.start ? "" : send({ type: "content_block_stop", index: index++ });
    for (const { input, ...call } of calls) {
      const json = JSON.stringify(input);
      out +=
        send({ type: "content_block_start", index, content_block: { ...call, input: {} } }) +
        send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } }) +
        send({ type: "content_block_stop", index: index++ });
    }
    return out + send({ ...messageDelta, delta: { ...messageDelta.delta, stop_reason: "tool_use" } });
  }

  function recover(raw) {
    const event = readEvent(raw);
    const own = block !== null && event?.index === block.index;
    if (held) {
      if (event?.type === "message_delta") {
        const calls = !held.other && parseToolCalls(block.text, schemas);
        const out = calls ? sendCalls(calls, event) : release() + `${raw}\n\n`;
        block = held = null;
        return out;
      }
      if (own && event.type === "content_block_delta") block.text += event.delta?.text ?? "";
      else {
        held.events += `${raw}\n\n`;
        held.other ||= !own && String(event?.type).startsWith("content_block");
      }
      return "";
    }
    if (event?.type === "content_block_start" && event.content_block?.type === "text") {
      block = { index: event.index, start: `${raw}\n\n`, text: "" };
      return "";
    }
    if (!own) return `${raw}\n\n`;
    if (event.type === "content_block_stop") {
      const out = release() + `${raw}\n\n`;
      block = null;
      return out;
    }
    const text = event.delta?.text ?? "";
    if (!block.start && !text.includes(callTag)) return `${raw}\n\n`;
    block.text += text;
    const at = block.text.indexOf(callTag);
    const before = at < 0 ? block.text : block.text.slice(0, at);
    let out = "";
    if (before.trim()) {
      out = (block.start ?? "") + textDelta(before);
      block.start = null;
      block.text = block.text.slice(before.length);
    }
    if (at >= 0) held = { events: "", other: false };
    return out;
  }

  return eventStream(recover, () => (block ? release() : ""));
}

export function rewriteRequest(body, models = {}, notes = "") {
  const request = JSON.parse(body);
  let changed = false;

  if (Array.isArray(request.tools) && dropRefProperties(request.tools)) {
    changed = true;
  }

  if (inlineLoadedTools(request)) {
    changed = true;
  }

  // The notes advise on using tools (subagents, reads), so only requests that carry
  // tools get them: the main agent's and its subagents'. Safety checks and WebSearch
  // have fixed prompts of their own, and helper calls (titles, summaries) have no tools.
  // The same block goes last on every turn, so the server still reuses its cached prompt.
  if (notes && request.tools?.length > 0 && !webSearchTool(request) && !isSafetyCheck(request)) {
    request.system = [...asBlocks(request.system), { type: "text", text: notes }];
    changed = true;
  }

  // Claude Code marks a 1M-context selection with a [1m] suffix on the name.
  const id = models[String(request.model).replace(/\[1m\]$/, "")];
  if (id && id !== request.model) {
    request.model = id;
    changed = true;
  }

  if (Array.isArray(request.messages) && request.messages.some((m) => m.role === "system")) {
    const messages = [];
    // Reminders with no user turn before them wait for the next one.
    let pending = [];
    for (const message of request.messages) {
      if (message.role === "system") {
        const reminders = asBlocks(message.content)
          .filter((block) => block.type === "text")
          .map((block) => ({ type: "text", text: `<system-reminder>\n${block.text}\n</system-reminder>` }));
        const last = messages.at(-1);
        if (last?.role === "user") last.content = [...asBlocks(last.content), ...reminders];
        else pending.push(...reminders);
      } else if (message.role === "user" && pending.length > 0) {
        messages.push({ ...message, content: [...pending, ...asBlocks(message.content)] });
        pending = [];
      } else {
        messages.push(message);
      }
    }
    if (pending.length > 0) messages.push({ role: "user", content: pending });
    request.messages = messages;
    changed = true;
  }

  return changed ? JSON.stringify(request) : body;
}

// Auto mode's safety check of each tool call names the main model but has its own
// system prompt, which starts with this sentence.
const safetyCheck = "You are a security monitor for autonomous AI coding agents.";
const isSafetyCheck = (request) => asBlocks(request.system).some((block) => block.text?.startsWith(safetyCheck));

// The server-side search tool a WebSearch request carries, or undefined.
const webSearchTool = (request) => request.tools?.find((tool) => String(tool.type).startsWith("web_search"));

// The body to send to Anthropic instead of the local server, or null. Only with a
// helper model: Claude Code's Haiku role then names a Claude model, and two kinds
// of request it sends to the main model move to the helper. WebSearch carries
// Anthropic's server-side search tool, which a local server cannot run. Safety
// checks took a fifth to a third of the local model's busy time, ahead of the
// actions they hold up; with an Opus main agent they would run on Opus.
export function cloudRequest(body, helper) {
  if (!helper) return null;
  const request = JSON.parse(body);
  if (isSafetyCheck(request)) return JSON.stringify({ ...request, model: helper });
  if (String(request.model).startsWith("claude-")) return body;
  if (!webSearchTool(request)) return null;
  // A search inherits the session's thinking and effort: at max effort the helper
  // took 149 s for one search against 11 s at low, for the same links.
  const { thinking, ...search } = request;
  return JSON.stringify({ ...search, model: helper, output_config: { ...request.output_config, effort: "low" } });
}

// The query of a WebSearch request, with its domain filters as site: terms, or
// null for any other request. Claude Code sends WebSearch to the main model as
// "Perform a web search for the query: ..." with Anthropic's server-side
// web_search tool, which a local server cannot run.
export function webSearchQuery(body) {
  const request = JSON.parse(body);
  const tool = webSearchTool(request);
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
  const notesFile = process.env.CLAUDE_LOCAL_NOTES;
  const notes = notesFile ? fs.readFileSync(notesFile, "utf8").trim() : "";
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      let body = Buffer.concat(chunks);
      let target = upstream;
      let schemas = {};
      const messages = req.method === "POST" && req.url.split("?")[0] === "/v1/messages";
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        try {
          const cloud = cloudRequest(body.toString(), helper);
          const query = cloud || !messages ? null : webSearchQuery(body.toString());
          if (query !== null) {
            const reply = textMessage(JSON.parse(body), await searchExa(query));
            res.writeHead(200, { "content-type": reply.type });
            res.end(reply.body);
            return;
          }
          if (cloud) target = anthropic;
          else schemas = loadedSchemas(body.toString());
          body = Buffer.from(cloud ?? rewriteRequest(body.toString(), models, notes));
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
          if (target !== upstream || !messages || response.statusCode !== 200 || response.headers["content-encoding"]) {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
            return;
          }
          const { "content-length": _, ...headers } = response.headers;
          res.writeHead(200, headers);
          response.setEncoding("utf8");
          if (String(headers["content-type"]).startsWith("text/event-stream")) {
            response.pipe(unwrapEvents()).pipe(recoverCalls(schemas)).pipe(res);
            return;
          }
          let reply = "";
          response.on("data", (chunk) => (reply += chunk));
          response.on("end", () => {
            try {
              res.end(unwrapReply(reply, schemas));
            } catch {
              res.end(reply);
            }
          });
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
