const assert = require("node:assert/strict");
const test = require("node:test");

const {
  patchSource,
} = require("../patches/patch-pi-subagents-inherit-model.js");

const source = `  [
    "Explore",
    {
      builtinToolNames: READ_ONLY_TOOLS,
      model: "anthropic/claude-haiku-4-5-20251001",
      systemPrompt: "Explore",
    },
  ],
  [
    "Plan",
    {
      builtinToolNames: READ_ONLY_TOOLS,
      systemPrompt: "Plan",
    },
  ],
`;

test("patchSource removes the Explore model default", () => {
  const result = patchSource(source);
  assert.equal(result.status, "patched");
  assert.doesNotMatch(result.source, /model: "anthropic\//);
  assert.match(result.source, /builtinToolNames: READ_ONLY_TOOLS,\n      systemPrompt:/);
});

test("patchSource is idempotent", () => {
  const first = patchSource(source);
  const second = patchSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

