const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/ui/agent-widget.ts",
);

function restoreKnownPatch(source) {
  const start = source.indexOf("import { getMarkdownTheme } from \"@earendil-works/pi-coding-agent\";\n");
  if (start !== -1) {
    source = source.replace('import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";\n', "");
  }

  source = source
    .replace('import { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";\n', 'import { ERROR_STATUSES, type Theme } from "#src/ui/display";\n')
    .replace('import { liveSource } from "#src/ui/session-navigation";\n', "")
    .replace('import { TranscriptOverlay, type SessionNavigatorUI } from "#src/ui/session-navigator";\n', "")
    .replace('export type UICtx = SessionNavigatorUI & {\n', 'export type UICtx = {\n');

  source = source.replace(/\n\ntype PiMouseEvent = \{ raw\?: string; button: number; x: number; y: number; wheel\?: boolean \};[\s\S]*?function stripAnsi\(text: string\): string \{\n  return text\.replace\(ANSI_PATTERN, ""\);\n\}\n/, "\n");

  source = source.replace(`  /** Releases scoped mouse reporting while the clickable footer hint is active. */
  private releaseFooterMouse: (() => void) | undefined;
  /** Prevents repeated footer clicks from opening stacked transcript overlays. */
  private openingSession = false;
`, "");

  source = source.replace(`      this.releaseFooterMouseCapture();
      this.uiCtx = ctx;
`, `      this.uiCtx = ctx;
`);

  source = source.replace(`    if (newStatusText) newStatusText += " · click to view";
    if (newStatusText !== this.lastStatusText) {
      this.uiCtx!.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
    if (newStatusText) this.ensureFooterMouseCapture();
    else this.releaseFooterMouseCapture();
  }
`, `    if (newStatusText !== this.lastStatusText) {
      this.uiCtx!.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
  }
`);

  source = source.replace(/\n  private releaseFooterMouseCapture\(\): void \{[\s\S]*?\n  \/\*\* Force an immediate widget update\. \*\//, "\n  /** Force an immediate widget update. */");

  source = source.replace(`      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        this.ensureFooterMouseCapture();
        return {
`, `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
`);

  source = source.replace(`      // Widget already registered — just request a re-render of existing components.
      this.ensureFooterMouseCapture();
      this.tui?.requestRender();
`, `      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
`);

  source = source.replace(`    this.releaseFooterMouseCapture();
    if (this.uiCtx) {
`, `    if (this.uiCtx) {
`);

  return source;
}

function restoreFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-subagents agent widget restore skipped; missing ${file}`);
    return "missing";
  }
  const before = fs.readFileSync(file, "utf8");
  const after = restoreKnownPatch(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    log("[ai-harnesses] restored pi-subagents agent widget to upstream rendering");
    return "restored";
  }
  return "unchanged";
}

if (require.main === module) restoreFile(process.argv[2] || DEFAULT_TARGET);

module.exports = { restoreKnownPatch, restoreFile, DEFAULT_TARGET };
