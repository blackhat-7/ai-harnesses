const assert = require("node:assert/strict");
const test = require("node:test");

const { hoistSystemMessages } = require("../scripts/claude-local-shim.mjs");

test("trailing system messages move into the system field", () => {
  const request = {
    system: [{ type: "text", text: "You are Claude Code." }],
    messages: [
      { role: "user", content: "hi" },
      { role: "system", content: [{ type: "text", text: "hook context" }] },
    ],
  };

  const result = JSON.parse(hoistSystemMessages(JSON.stringify(request)));

  assert.deepEqual(result.messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(result.system, [
    { type: "text", text: "You are Claude Code." },
    { type: "text", text: "hook context" },
  ]);
});

test("a string system prompt is normalized to blocks", () => {
  const request = {
    system: "base prompt",
    messages: [{ role: "system", content: "extra" }],
  };

  const result = JSON.parse(hoistSystemMessages(JSON.stringify(request)));

  assert.deepEqual(result.system, [
    { type: "text", text: "base prompt" },
    { type: "text", text: "extra" },
  ]);
  assert.deepEqual(result.messages, []);
});

test("requests without system messages are forwarded byte for byte", () => {
  const body = JSON.stringify({ system: "base", messages: [{ role: "user", content: "hi" }] });

  assert.equal(hoistSystemMessages(body), body);
});
