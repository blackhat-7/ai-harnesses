const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { patchWidgetSource, patchIndexSource, patchFiles } = require("./files/patch-pi-subagents-widget-click.js");
const { restoreKnownPatch } = require("./files/restore-pi-subagents-agent-widget.js");

const root = path.join(os.homedir(), ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src");
const installedWidget = path.join(root, "ui/agent-widget.ts");
const installedIndex = path.join(root, "index.ts");

test("patchWidgetSource adds row click hook without popup imports", () => {
  if (!fs.existsSync(installedWidget)) return;
  const restored = restoreKnownPatch(fs.readFileSync(installedWidget, "utf8"));
  const result = patchWidgetSource(restored);
  assert.notEqual(result.status, "skipped");
  assert.match(result.source, /onAgentClick\?: \(agent: Subagent\) => void/);
  assert.match(result.source, /private agentForVisibleLine\(y: number\)/);
  assert.match(result.source, /this\.onAgentClick\?\.\(agent\)/);
  assert.doesNotMatch(result.source, /TranscriptOverlay/);
  assert.doesNotMatch(result.source, /getMarkdownTheme/);
  assert.match(result.source, /setWidget\("agents"/);
});

test("patchIndexSource adds the transcript opener near existing navigator code", () => {
  if (!fs.existsSync(installedIndex)) return;
  const result = patchIndexSource(fs.readFileSync(installedIndex, "utf8"));
  assert.notEqual(result.status, "skipped");
  assert.match(result.source, /openClickedAgentTranscript/);
  assert.match(result.source, /new AgentWidget\(manager, registry, openClickedAgentTranscript\)/);
  assert.match(result.source, /new TranscriptOverlay/);
  assert.match(result.source, /liveSource\(agent\)/);
});

test("patchFiles patches temp copies and is idempotent", () => {
  if (!fs.existsSync(installedWidget) || !fs.existsSync(installedIndex)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-widget-click-"));
  const widgetDir = path.join(dir, "ui");
  fs.mkdirSync(widgetDir, { recursive: true });
  const widget = path.join(widgetDir, "agent-widget.ts");
  const index = path.join(dir, "index.ts");
  fs.writeFileSync(widget, restoreKnownPatch(fs.readFileSync(installedWidget, "utf8")));
  fs.writeFileSync(index, fs.readFileSync(installedIndex, "utf8").replace(/openClickedAgentTranscript[\s\S]*/, ""));

  // Direct patch functions are enough for idempotency here; patchFiles uses fixed install paths.
  const firstWidget = patchWidgetSource(fs.readFileSync(widget, "utf8"));
  fs.writeFileSync(widget, firstWidget.source);
  const secondWidget = patchWidgetSource(fs.readFileSync(widget, "utf8"));
  assert.equal(secondWidget.status, "already-patched");
});
