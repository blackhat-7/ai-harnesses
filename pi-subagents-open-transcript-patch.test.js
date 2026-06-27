const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { patchSource } = require("./files/patch-pi-subagents-open-transcript.js");

const installedIndex = path.join(os.homedir(), ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/index.ts");

test("patchSource exposes a transcript opener without touching the widget", () => {
  if (!fs.existsSync(installedIndex)) return;
  const result = patchSource(fs.readFileSync(installedIndex, "utf8"));
  assert.notEqual(result.status, "skipped");
  assert.match(result.source, /@blackhat\/pi-subagents:openTranscript/);
  assert.match(result.source, /new TranscriptOverlay/);
  assert.match(result.source, /liveSource\(agent\)/);
  assert.match(result.source, /getMarkdownTheme\(\)/);
});

test("patchSource is idempotent", () => {
  if (!fs.existsSync(installedIndex)) return;
  const first = patchSource(fs.readFileSync(installedIndex, "utf8"));
  const second = patchSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});
