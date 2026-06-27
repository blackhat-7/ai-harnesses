const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(os.homedir(), ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/index.ts");
const PATCH_MARKER = "@blackhat/pi-subagents:openTranscript";

const edits = [
  {
    oldText: `  createAgentSession,
  DefaultResourceLoader,
`,
    newText: `  createAgentSession,
  DefaultResourceLoader,
  getMarkdownTheme,
`,
  },
  {
    oldText: `import { AgentWidget } from "#src/ui/agent-widget";
import { SessionNavigatorHandler } from "#src/ui/session-navigator";
`,
    newText: `import { AgentWidget } from "#src/ui/agent-widget";
import { liveSource } from "#src/ui/session-navigation";
import { SessionNavigatorHandler, TranscriptOverlay } from "#src/ui/session-navigator";
`,
  },
  {
    oldText: `  const service = new SubagentsServiceAdapter(manager, resolveModel, runtime);
  publishSubagentsService(service);
`,
    newText: `  const service = new SubagentsServiceAdapter(manager, resolveModel, runtime);
  publishSubagentsService(service);

  const clickedTranscriptKey = Symbol.for("@blackhat/pi-subagents:openTranscript");
  (globalThis as Record<symbol, unknown>)[clickedTranscriptKey] = (id: string, ui: any, cwd: string): boolean => {
    const agent = manager.listAgents().find((candidate) => candidate.id === id);
    if (!agent?.isSessionReady()) return false;
    void ui.custom<undefined>(
      (tui, theme, _keybindings, done) => new TranscriptOverlay({
        ui,
        tui,
        theme,
        source: liveSource(agent),
        done,
        cwd,
        markdownTheme: getMarkdownTheme(),
      }),
      { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } },
    ).catch((error: unknown) => {
      ui.notify(error instanceof Error ? error.message : String(error), "error");
    });
    return true;
  };
`,
  },
  {
    oldText: `  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
`,
    newText: `  pi.on("session_shutdown", () => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("@blackhat/pi-subagents:openTranscript")];
    lifecycle.handleSessionShutdown();
  });
`,
  },
];

function restoreLegacyIndexPatch(source) {
  if (!source.includes("openClickedAgentTranscript")) return source;
  source = source.replace("  getMarkdownTheme,\n", "");
  source = source.replace('import { liveSource } from "#src/ui/session-navigation";\n', "");
  source = source.replace('import { SessionNavigatorHandler, TranscriptOverlay } from "#src/ui/session-navigator";\n', 'import { SessionNavigatorHandler } from "#src/ui/session-navigator";\n');
  source = source.replace(/\n  let lastUiContext: \{ ui: any; cwd: string \} \| undefined;[\s\S]*?const widget = new AgentWidget\(manager, registry, openClickedAgentTranscript\);\n/, "\n  // Live widget: constructed after the manager (it polls listAgents()) and\n  // registered as a lifecycle observer so it self-drives its update timer.\n  const widget = new AgentWidget(manager, registry);\n");
  source = source.replace(`  pi.on("tool_execution_start", (event, ctx) => {
    lastUiContext = { ui: ctx.ui, cwd: ctx.cwd };
    toolStart.handleToolExecutionStart(event, ctx);
  });
`, `  pi.on("tool_execution_start", (event, ctx) => toolStart.handleToolExecutionStart(event, ctx));
`);
  return source;
}

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return { source, missing: true };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  return { source: source.slice(0, first) + newText + source.slice(first + oldText.length), missing: false };
}

function patchSource(source) {
  if (source.includes(PATCH_MARKER)) return { source, status: "already-patched" };
  let next = restoreLegacyIndexPatch(source);
  const missing = [];
  for (const edit of edits) {
    const result = replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) missing.push(edit.oldText.slice(0, 80));
    next = result.source;
  }
  if (missing.length > 0) return { source, status: "skipped", missing };
  return { source: next, status: "patched" };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-subagents transcript opener patch skipped; missing ${file}`);
    return "missing";
  }
  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched") {
    fs.writeFileSync(file, result.source);
    log("[ai-harnesses] patched pi-subagents transcript opener");
  } else if (result.status === "skipped") {
    log("[ai-harnesses] pi-subagents transcript opener patch skipped; upstream file shape changed");
  }
  return result.status;
}

if (require.main === module) patchFile(process.argv[2] || DEFAULT_TARGET);

module.exports = { patchSource, patchFile, DEFAULT_TARGET };
