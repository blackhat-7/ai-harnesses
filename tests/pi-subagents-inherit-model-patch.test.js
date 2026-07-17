const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  patchFile,
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

test("patchFile patches a file once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-model-patch-"));
  const file = path.join(dir, "default-agents.ts");
  fs.writeFileSync(file, source);

  const logs = [];
  assert.equal(patchFile(file, (message) => logs.push(message)), "patched");
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /model: "anthropic\//);
  assert.equal(patchFile(file, (message) => logs.push(message)), "already-patched");
  assert.ok(logs.some((message) => message.includes("inherit the parent model")));
});
