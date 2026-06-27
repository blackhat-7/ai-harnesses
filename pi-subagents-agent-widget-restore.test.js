const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { restoreFile, restoreKnownPatch } = require("./files/restore-pi-subagents-agent-widget.js");

test("restoreKnownPatch removes the old invasive click patch shape", () => {
  const restored = restoreKnownPatch(`import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";\nimport { AgentTypeRegistry } from "#src/config/agent-types";\nimport { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";\nimport { liveSource } from "#src/ui/session-navigation";\nimport { TranscriptOverlay, type SessionNavigatorUI } from "#src/ui/session-navigator";\nexport type UICtx = SessionNavigatorUI & {\n  setStatus(key: string, text: string | undefined): void;\n};\n\ntype PiMouseEvent = { raw?: string; button: number; x: number; y: number; wheel?: boolean };\nfunction piMouseCapture(): undefined { return undefined; }\nconst ANSI_PATTERN = /x/;\nfunction stripAnsi(text: string): string {\n  return text.replace(ANSI_PATTERN, "");\n}\nclass X {\n  private tui: any | undefined;\n  /** Releases scoped mouse reporting while the clickable footer hint is active. */\n  private releaseFooterMouse: (() => void) | undefined;\n  /** Prevents repeated footer clicks from opening stacked transcript overlays. */\n  private openingSession = false;\n  private lastStatusText: string | undefined;\n}\n`);
  assert.doesNotMatch(restored, /getMarkdownTheme/);
  assert.doesNotMatch(restored, /piMouseCapture/);
  assert.doesNotMatch(restored, /openFooterAgentSession/);
});

test("restoreFile is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-widget-restore-"));
  const file = path.join(dir, "agent-widget.ts");
  fs.writeFileSync(file, `import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";\nimport { AgentTypeRegistry } from "#src/config/agent-types";\nimport { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";\nimport { liveSource } from "#src/ui/session-navigation";\nimport { TranscriptOverlay, type SessionNavigatorUI } from "#src/ui/session-navigator";\nexport type UICtx = SessionNavigatorUI & {\n  setStatus(key: string, text: string | undefined): void;\n};\n\ntype PiMouseEvent = { raw?: string; button: number; x: number; y: number; wheel?: boolean };\nfunction piMouseCapture(): undefined { return undefined; }\nconst ANSI_PATTERN = /x/;\nfunction stripAnsi(text: string): string {\n  return text.replace(ANSI_PATTERN, "");\n}\nclass X {\n  private tui: any | undefined;\n  /** Releases scoped mouse reporting while the clickable footer hint is active. */\n  private releaseFooterMouse: (() => void) | undefined;\n  /** Prevents repeated footer clicks from opening stacked transcript overlays. */\n  private openingSession = false;\n  private lastStatusText: string | undefined;\n}\n`);
  assert.equal(restoreFile(file, () => {}), "restored");
  assert.equal(restoreFile(file, () => {}), "unchanged");
});
