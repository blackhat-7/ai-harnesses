const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { restoreKnownPatch } = require("./restore-pi-subagents-agent-widget.js");

const ROOT = path.join(os.homedir(), ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src");
const WIDGET_TARGET = path.join(ROOT, "ui/agent-widget.ts");
const INDEX_TARGET = path.join(ROOT, "index.ts");
const PATCH_MARKER = "onAgentClick?: (agent: Subagent) => void";
const INDEX_MARKER = "openClickedAgentTranscript";

const widgetEdits = [
  {
    oldText: `import { ERROR_STATUSES, type Theme } from "#src/ui/display";
`,
    newText: `import { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";
`,
  },
  {
    oldText: `export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};
`,
    newText: `export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  onTerminalInput?(handler: (data: string) => { consume?: boolean } | undefined): () => void;
};

type PiMouseEvent = { raw?: string; button: number; x: number; y: number; wheel?: boolean };

function piMouseCapture(): ((args: {
  ui: UICtx;
  tui: any;
  onMouse: (event: PiMouseEvent) => void;
  consume?: boolean;
}) => () => void) | undefined {
  const capture = (globalThis as { piMouse?: { capture?: unknown } }).piMouse?.capture;
  return typeof capture === "function" ? capture as (args: {
    ui: UICtx;
    tui: any;
    onMouse: (event: PiMouseEvent) => void;
    consume?: boolean;
  }) => () => void : undefined;
}

const ANSI_PATTERN = new RegExp("\\\\u001B\\\\[[0-?]*[ -/]*[@-~]|\\\\u001B\\\\][\\\\s\\\\S]*?(?:\\\\u0007|\\\\u001B\\\\\\\\)", "g");
const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");
`,
  },
  {
    oldText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
`,
    newText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Releases scoped mouse reporting while the agents widget is visible. */
  private releaseMouse: (() => void) | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
`,
  },
  {
    oldText: `  constructor(
    private manager: SubagentManager,
    private registry: AgentTypeRegistry,
  ) {}
`,
    newText: `  constructor(
    private manager: SubagentManager,
    private registry: AgentTypeRegistry,
    private readonly onAgentClick?: (agent: Subagent) => void,
  ) {}
`,
  },
  {
    oldText: `      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
`,
    newText: `      this.releaseMouseCapture();
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
`,
  },
  {
    oldText: `  /** Force an immediate widget update. */
  update() {
`,
    newText: `  private releaseMouseCapture(): void {
    this.releaseMouse?.();
    this.releaseMouse = undefined;
  }

  private ensureMouseCapture(): void {
    if (this.releaseMouse || !this.onAgentClick || !this.uiCtx || !this.tui) return;
    try {
      this.releaseMouse = piMouseCapture()?.({
        ui: this.uiCtx,
        tui: this.tui,
        consume: false,
        onMouse: (event) => {
          try {
            this.handleMouse(event);
          } catch {
            // Mouse support must never affect widget rendering.
          }
        },
      });
    } catch {
      this.releaseMouse = undefined;
    }
  }

  private handleMouse(event: PiMouseEvent): void {
    if (event.wheel || (event.button & 3) !== 0 || event.raw?.endsWith("m")) return;
    const agent = this.agentForVisibleLine(event.y);
    if (agent) this.onAgentClick?.(agent);
  }

  private agentForVisibleLine(y: number): Subagent | undefined {
    const line = this.visibleLines()[y - 1];
    if (!line) return undefined;
    const agents = this.visibleWidgetAgents();
    const clickedName = agents.map((agent) => getDisplayName(agent.type, this.registry)).find((name) => line.includes(name));
    if (!clickedName) return undefined;
    const rowOrdinal = this.visibleLines().slice(0, y).filter((candidate) => candidate.includes(clickedName)).length;
    return agents.filter((agent) => getDisplayName(agent.type, this.registry) === clickedName)[Math.max(0, rowOrdinal - 1)];
  }

  private visibleWidgetAgents(): Subagent[] {
    const agents = this.listBackgroundAgents().filter((agent) => agent.isSessionReady());
    const finished = agents.filter((agent) => agent.status !== "running" && agent.status !== "queued" && agent.completedAt && this.shouldShowFinished(agent.id, agent.status));
    const running = agents.filter((agent) => agent.status === "running");
    return [...finished, ...running];
  }

  private visibleLines(): string[] {
    const previousLines = Array.isArray(this.tui?.previousLines) ? this.tui.previousLines as string[] : [];
    const rows = Number(this.tui?.terminal?.rows) || previousLines.length;
    const viewportTop = Number.isFinite(this.tui?.previousViewportTop)
      ? Number(this.tui.previousViewportTop)
      : Math.max(0, previousLines.length - rows);
    return previousLines.slice(viewportTop, viewportTop + rows).map(stripAnsi);
  }

  /** Force an immediate widget update. */
  update() {
`,
  },
  {
    oldText: `    if (this.widgetRegistered) {
      this.uiCtx!.setWidget("agents", undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
`,
    newText: `    if (this.widgetRegistered) {
      this.releaseMouseCapture();
      this.uiCtx!.setWidget("agents", undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
`,
  },
  {
    oldText: `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
            // Theme changed — force re-registration so factory captures fresh theme.
            this.widgetRegistered = false;
            this.tui = undefined;
          },
        };
      }, { placement: "aboveEditor" });
`,
    newText: `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        this.ensureMouseCapture();
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
            // Theme changed — force re-registration so factory captures fresh theme.
            this.releaseMouseCapture();
            this.widgetRegistered = false;
            this.tui = undefined;
          },
        };
      }, { placement: "aboveEditor" });
`,
  },
  {
    oldText: `      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
`,
    newText: `      // Widget already registered — just request a re-render of existing components.
      this.ensureMouseCapture();
      this.tui?.requestRender();
`,
  },
  {
    oldText: `    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
`,
    newText: `    this.releaseMouseCapture();
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
`,
  },
];

const indexEdits = [
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
    oldText: `  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(manager, registry);
`,
    newText: `  let lastUiContext: { ui: any; cwd: string } | undefined;
  let openingClickedAgent = false;
  const openClickedAgentTranscript = (agent: any): void => {
    const ctx = lastUiContext;
    if (!ctx || openingClickedAgent || !agent.isSessionReady()) return;
    openingClickedAgent = true;
    void ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) => new TranscriptOverlay({
        ui: ctx.ui,
        tui,
        theme,
        source: liveSource(agent),
        done,
        cwd: ctx.cwd,
        markdownTheme: getMarkdownTheme(),
      }),
      { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } },
    ).catch((error: unknown) => {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      openingClickedAgent = false;
    });
  };

  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(manager, registry, openClickedAgentTranscript);
`,
  },
  {
    oldText: `  pi.on("tool_execution_start", (event, ctx) => toolStart.handleToolExecutionStart(event, ctx));
`,
    newText: `  pi.on("tool_execution_start", (event, ctx) => {
    lastUiContext = { ui: ctx.ui, cwd: ctx.cwd };
    toolStart.handleToolExecutionStart(event, ctx);
  });
`,
  },
];

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return { source, missing: true };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  return { source: source.slice(0, first) + newText + source.slice(first + oldText.length), missing: false };
}

function applyEdits(source, edits) {
  let next = source;
  const missing = [];
  for (const edit of edits) {
    const result = replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) missing.push(edit.oldText.slice(0, 80));
    next = result.source;
  }
  return { source: next, missing };
}

function patchWidgetSource(source) {
  if (source.includes(PATCH_MARKER)) return { source, status: "already-patched" };
  const restored = restoreKnownPatch(source);
  const result = applyEdits(restored, widgetEdits);
  if (result.missing.length > 0) return { source: restored, status: "skipped", missing: result.missing };
  return { source: result.source, status: restored === source ? "patched" : "restored-and-patched" };
}

function patchIndexSource(source) {
  if (source.includes(INDEX_MARKER)) return { source, status: "already-patched" };
  const result = applyEdits(source, indexEdits);
  if (result.missing.length > 0) return { source, status: "skipped", missing: result.missing };
  return { source: result.source, status: "patched" };
}

function patchOne(file, patchSource, label, log) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] ${label} patch skipped; missing ${file}`);
    return "missing";
  }
  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (["patched", "restored-and-patched", "restored-already-patched"].includes(result.status)) {
    fs.writeFileSync(file, result.source);
    log(`[ai-harnesses] patched ${label}`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] ${label} patch skipped; upstream file shape changed`);
  }
  return result.status;
}

function patchFiles(log = console.warn) {
  const widget = patchOne(WIDGET_TARGET, patchWidgetSource, "pi-subagents widget row click", log);
  const index = patchOne(INDEX_TARGET, patchIndexSource, "pi-subagents clicked transcript opener", log);
  return { widget, index };
}

if (require.main === module) patchFiles();

module.exports = { patchWidgetSource, patchIndexSource, patchFiles, WIDGET_TARGET, INDEX_TARGET };
