const assert = require("node:assert/strict");
const test = require("node:test");

const { cloudRequest, forwardHeaders, rewriteRequest, textMessage, webSearchQuery } = require("../scripts/claude-local-shim.mjs");

test("trailing system messages move into the system field", () => {
  const request = {
    system: [{ type: "text", text: "You are Claude Code." }],
    messages: [
      { role: "user", content: "hi" },
      { role: "system", content: [{ type: "text", text: "hook context" }] },
    ],
  };

  const result = JSON.parse(rewriteRequest(JSON.stringify(request)));

  assert.deepEqual(result.messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(result.system, [
    { type: "text", text: "You are Claude Code." },
    { type: "text", text: "hook context" },
  ]);
});

test("a string system prompt is normalized to blocks", () => {
  const request = { system: "base prompt", messages: [{ role: "system", content: "extra" }] };

  const result = JSON.parse(rewriteRequest(JSON.stringify(request)));

  assert.deepEqual(result.system, [
    { type: "text", text: "base prompt" },
    { type: "text", text: "extra" },
  ]);
  assert.deepEqual(result.messages, []);
});

test("display names, including a [1m] selection, become server model ids", () => {
  const models = { "Qwen-Q4_K_M": "/models/Qwen-Q4_K_M.gguf" };
  const body = JSON.stringify({ model: "Qwen-Q4_K_M[1m]", messages: [{ role: "user", content: "hi" }] });

  const result = JSON.parse(rewriteRequest(body, models));

  assert.equal(result.model, "/models/Qwen-Q4_K_M.gguf");
});

test("schema properties named $ref are dropped, $ref references are kept", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { name: "first", input_schema: { type: "object", properties: { $ref: { type: "string" } } } },
      { name: "unaffected", input_schema: { type: "object", properties: { id: { type: "string" } } } },
      {
        name: "create_dashboard",
        input_schema: {
          $defs: { Ref: { type: "object", properties: { $ref: { type: "string" }, id: { type: "string" } }, required: ["$ref", "id"] } },
          type: "object",
          properties: { spec: { $ref: "#/$defs/Ref" } },
        },
      },
    ],
  });

  const tools = JSON.parse(rewriteRequest(body)).tools;
  const schema = tools[2].input_schema;

  // Every tool is visited, not just the first one with a "$ref" property.
  assert.deepEqual(Object.keys(tools[0].input_schema.properties), []);
  assert.deepEqual(Object.keys(tools[1].input_schema.properties), ["id"]);
  assert.deepEqual(Object.keys(schema.$defs.Ref.properties), ["id"]);
  assert.deepEqual(schema.$defs.Ref.required, ["id"]);
  assert.equal(schema.properties.spec.$ref, "#/$defs/Ref");
});

test("unknown models and plain requests are forwarded byte for byte", () => {
  const body = JSON.stringify({ model: "gpt-oss:20b", messages: [{ role: "user", content: "hi" }] });

  assert.equal(rewriteRequest(body, { "Qwen-Q4_K_M": "/models/Qwen-Q4_K_M.gguf" }), body);
});

test("with a helper model, Claude models and WebSearch go to Anthropic", () => {
  const haiku = JSON.stringify({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "title?" }] });
  const search = { model: "Flash-Next", tools: [{ type: "web_search_20250305", name: "web_search" }], messages: [] };
  const local = JSON.stringify({ model: "Flash-Next", tools: [{ name: "Bash" }], messages: [] });

  assert.equal(cloudRequest(haiku, "claude-haiku-5-5"), haiku);
  assert.deepEqual(JSON.parse(cloudRequest(JSON.stringify(search), "claude-haiku-5-5")), { ...search, model: "claude-haiku-5-5" });
  assert.equal(cloudRequest(local, "claude-haiku-5-5"), null);
});

test("without a helper model, everything stays local", () => {
  const haiku = JSON.stringify({ model: "claude-haiku-5-5", messages: [] });
  const search = JSON.stringify({ model: "Flash-Next", tools: [{ type: "web_search_20250305" }], messages: [] });

  assert.equal(cloudRequest(haiku, ""), null);
  assert.equal(cloudRequest(search, undefined), null);
});

test("a WebSearch request gives its query with domain filters as site: terms", () => {
  const search = JSON.stringify({
    model: "Flash-Next",
    tools: [{ type: "web_search_20250305", name: "web_search", allowed_domains: ["github.com"], blocked_domains: ["reddit.com"] }],
    messages: [{ role: "user", content: [{ type: "text", text: "Perform a web search for the query: llama.cpp release" }] }],
  });
  const turn = JSON.stringify({ model: "Flash-Next", tools: [{ name: "Bash" }], messages: [{ role: "user", content: "hi" }] });

  assert.equal(webSearchQuery(search), "llama.cpp release site:github.com -site:reddit.com");
  assert.equal(webSearchQuery(turn), null);
});

test("a text reply is an Anthropic message, streamed as events when asked", () => {
  const plain = JSON.parse(textMessage({ model: "m" }, "results").body);
  const events = textMessage({ model: "m", stream: true }, "results")
    .body.trim()
    .split("\n\n")
    .map((event) => JSON.parse(event.split("\ndata: ")[1]));

  assert.deepEqual(plain.content, [{ type: "text", text: "results" }]);
  assert.equal(plain.stop_reason, "end_turn");
  assert.deepEqual(
    events.map((event) => event.type),
    ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"],
  );
  assert.equal(events[2].delta.text, "results");
});

test("credentials go to Anthropic", () => {
  const headers = { authorization: "Bearer sk-ant-oat", host: "127.0.0.1:1", "anthropic-version": "2023-06-01" };

  assert.deepEqual(forwardHeaders(headers, new URL("https://api.anthropic.com"), Buffer.from("{}")), {
    authorization: "Bearer sk-ant-oat",
    host: "api.anthropic.com",
    "anthropic-version": "2023-06-01",
    "content-length": 2,
  });
});

test("credentials are not forwarded to the model server", () => {
  const headers = { authorization: "Bearer sk-ant-oat", "x-api-key": "sk-ant", host: "127.0.0.1:1", "anthropic-version": "2023-06-01" };

  assert.deepEqual(forwardHeaders(headers, new URL("http://pc:6868"), Buffer.from("{}")), {
    host: "pc:6868",
    "anthropic-version": "2023-06-01",
    "content-length": 2,
  });
});
