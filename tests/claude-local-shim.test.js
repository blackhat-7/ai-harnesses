const assert = require("node:assert/strict");
const test = require("node:test");

const { rewriteRequest } = require("../scripts/claude-local-shim.mjs");

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
