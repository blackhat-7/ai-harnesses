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

test("unknown models and plain requests are forwarded byte for byte", () => {
  const body = JSON.stringify({ model: "gpt-oss:20b", messages: [{ role: "user", content: "hi" }] });

  assert.equal(rewriteRequest(body, { "Qwen-Q4_K_M": "/models/Qwen-Q4_K_M.gguf" }), body);
});
