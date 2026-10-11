const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { default: registerLean, matcher } = require("../patches/lean-mode.ts");

test("matcher treats * as a wildcard and everything else literally", () => {
  const excluded = matcher(["memory_*", "mcp__code_review_graph"]);
  assert.ok(excluded("memory_add"));
  assert.ok(excluded("mcp__code_review_graph"));
  assert.ok(!excluded("mcp__playwright"));
  assert.ok(!excluded("xmemory_add"));
});

function run(lean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lean-mode-"));
  fs.writeFileSync(
    path.join(dir, "lean.json"),
    JSON.stringify({ excludeTools: ["subagent", "memory_*"], skills: ["tdd"] }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  let active = ["read", "bash", "subagent", "memory_add", "web_search"];
  let handler;
  registerLean({
    registerFlag() {},
    getFlag: (name) => name === "lean" && lean,
    on: (_event, h) => (handler = h),
    getActiveTools: () => active,
    setActiveTools: (names) => (active = names),
  });
  const options = {
    selectedTools: ["read", "bash", "subagent"],
    skills: [{ name: "tdd" }, { name: "unslop" }],
  };
  handler({ systemPromptOptions: options });
  return { active, options };
}

test("--lean hides excluded tools and unlisted skills", () => {
  const { active, options } = run(true);
  assert.deepEqual(active, ["read", "bash", "web_search"]);
  assert.deepEqual(options.selectedTools, ["read", "bash"]);
  assert.deepEqual(options.skills, [{ name: "tdd" }]);
});

test("without --lean nothing changes", () => {
  const { active, options } = run(false);
  assert.equal(active.length, 5);
  assert.equal(options.skills.length, 2);
});
