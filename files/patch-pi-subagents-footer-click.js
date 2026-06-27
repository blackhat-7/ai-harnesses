const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/ui/agent-widget.ts",
);

const PATCH_MARKER = "private agentForWidgetLine";
const FOOTER_ONLY_MARKER = "private openFooterAgentSession";
const LEGACY_MARKER = "private clickedLine(y: number)";

const legacyClickEdits = [
  {
    oldText: `import { AgentTypeRegistry } from "#src/config/agent-types";
`,
    newText: `import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { AgentTypeRegistry } from "#src/config/agent-types";
`,
  },
  {
    oldText: `import { ERROR_STATUSES, type Theme } from "#src/ui/display";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";
`,
    newText: `import { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";
import { liveSource } from "#src/ui/session-navigation";
import { TranscriptOverlay, type SessionNavigatorUI } from "#src/ui/session-navigator";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";
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
    newText: `export type UICtx = SessionNavigatorUI & {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

type PiMouseEvent = { raw?: string; button: number; x: number; y: number; wheel?: boolean };

function piMouseCapture(): ((args: {
  ui: UICtx;
  tui: any;
  onMouse: (event: PiMouseEvent) => void;
}) => () => void) | undefined {
  const capture = (globalThis as { piMouse?: { capture?: unknown } }).piMouse?.capture;
  return typeof capture === "function" ? capture as (args: {
    ui: UICtx;
    tui: any;
    onMouse: (event: PiMouseEvent) => void;
  }) => () => void : undefined;
}

const ANSI_PATTERN = new RegExp("\\\\u001B\\\\[[0-?]*[ -/]*[@-~]|\\\\u001B\\\\][\\\\s\\\\S]*?(?:\\\\u0007|\\\\u001B\\\\\\\\)", "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
`,
  },
  {
    oldText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
`,
    newText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Releases scoped mouse reporting while the widget is visible. */
  private releaseMouse: (() => void) | undefined;
  /** Prevents repeated clicks from opening stacked transcript overlays. */
  private openingSession = false;
  /** Last status bar text, used to avoid redundant setStatus calls. */
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
    if (this.releaseMouse || !this.uiCtx || !this.tui) return;
    this.releaseMouse = piMouseCapture()?.({
      ui: this.uiCtx,
      tui: this.tui,
      onMouse: (event) => this.handleMouse(event),
    });
  }

  private handleMouse(event: PiMouseEvent): void {
    if (event.wheel || (event.button & 3) !== 0 || event.raw?.endsWith("m")) return;
    const line = this.clickedLine(event.y);
    if (!line) return;
    const agent = this.agentForLine(line);
    if (agent) this.openAgentSession(agent);
  }

  private clickedLine(y: number): string | undefined {
    const previousLines = Array.isArray(this.tui?.previousLines) ? this.tui.previousLines as string[] : undefined;
    if (!previousLines) return undefined;
    const rows = Number(this.tui?.terminal?.rows) || previousLines.length;
    const viewportTop = Number.isFinite(this.tui?.previousViewportTop)
      ? Number(this.tui.previousViewportTop)
      : Math.max(0, previousLines.length - rows);
    const line = previousLines[viewportTop + y - 1];
    if (!line) return undefined;
    const text = stripAnsi(line);
    if (!text.includes("Agents") && !this.listBackgroundAgents().some((agent) => text.includes(getDisplayName(agent.type, this.registry)))) return undefined;
    return text;
  }

  private agentForLine(line: string): Subagent | undefined {
    const ready = this.listBackgroundAgents().filter((agent) => agent.isSessionReady());
    return ready.find((agent) => line.includes(getDisplayName(agent.type, this.registry)))
      ?? ready.find((agent) => agent.status === "running")
      ?? ready[0];
  }

  private openAgentSession(agent: Subagent): void {
    if (!this.uiCtx || this.openingSession || !agent.isSessionReady()) return;
    this.openingSession = true;
    this.releaseMouseCapture();
    const ui = this.uiCtx;
    void ui.custom<undefined>(
      (tui, theme, _keybindings, done) => new TranscriptOverlay({
        ui,
        tui,
        theme,
        source: liveSource(agent),
        done,
        cwd: process.cwd(),
        markdownTheme: getMarkdownTheme(),
      }),
      { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } },
    ).catch((error: unknown) => {
      ui.notify(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      this.openingSession = false;
      this.ensureMouseCapture();
    });
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
`,
    newText: `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        this.ensureMouseCapture();
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
`,
  },
  {
    oldText: `            this.widgetRegistered = false;
            this.tui = undefined;
`,
    newText: `            this.releaseMouseCapture();
            this.widgetRegistered = false;
            this.tui = undefined;
`,
  },
  {
    oldText: `    } else {
      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
    }
`,
    newText: `    } else {
      // Widget already registered — just request a re-render of existing components.
      this.ensureMouseCapture();
      this.tui?.requestRender();
    }
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

const footerEdits = [
  {
    oldText: `import { AgentTypeRegistry } from "#src/config/agent-types";
`,
    newText: `import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { AgentTypeRegistry } from "#src/config/agent-types";
`,
  },
  {
    oldText: `import { ERROR_STATUSES, type Theme } from "#src/ui/display";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";
`,
    newText: `import { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";
import { liveSource } from "#src/ui/session-navigation";
import { TranscriptOverlay, type SessionNavigatorUI } from "#src/ui/session-navigator";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";
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
    newText: `export type UICtx = SessionNavigatorUI & {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

type PiMouseEvent = { raw?: string; button: number; x: number; y: number; wheel?: boolean };

function piMouseCapture(): ((args: {
  ui: UICtx;
  tui: any;
  onMouse: (event: PiMouseEvent) => void;
}) => () => void) | undefined {
  const capture = (globalThis as { piMouse?: { capture?: unknown } }).piMouse?.capture;
  return typeof capture === "function" ? capture as (args: {
    ui: UICtx;
    tui: any;
    onMouse: (event: PiMouseEvent) => void;
  }) => () => void : undefined;
}

const ANSI_PATTERN = new RegExp("\\\\u001B\\\\[[0-?]*[ -/]*[@-~]|\\\\u001B\\\\][\\\\s\\\\S]*?(?:\\\\u0007|\\\\u001B\\\\\\\\)", "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
`,
  },
  {
    oldText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
  private lastStatusText: string | undefined;
`,
    newText: `  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Releases scoped mouse reporting while the clickable footer hint is active. */
  private releaseFooterMouse: (() => void) | undefined;
  /** Prevents repeated footer clicks from opening stacked transcript overlays. */
  private openingSession = false;
  /** Last status bar text, used to avoid redundant setStatus calls. */
  private lastStatusText: string | undefined;
`,
  },
  {
    oldText: `      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
`,
    newText: `      this.releaseFooterMouseCapture();
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
`,
  },
  {
    oldText: `    if (newStatusText !== this.lastStatusText) {
      this.uiCtx!.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
  }
`,
    newText: `    if (newStatusText) newStatusText += " · click to view";
    if (newStatusText !== this.lastStatusText) {
      this.uiCtx!.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
    if (newStatusText) this.ensureFooterMouseCapture();
    else this.releaseFooterMouseCapture();
  }
`,
  },
  {
    oldText: `  /** Force an immediate widget update. */
  update() {
`,
    newText: `  private releaseFooterMouseCapture(): void {
    this.releaseFooterMouse?.();
    this.releaseFooterMouse = undefined;
  }

  private ensureFooterMouseCapture(): void {
    if (this.releaseFooterMouse || !this.uiCtx || !this.tui) return;
    this.releaseFooterMouse = piMouseCapture()?.({
      ui: this.uiCtx,
      tui: this.tui,
      onMouse: (event) => this.handleFooterMouse(event),
    });
  }

  private handleFooterMouse(event: PiMouseEvent): void {
    if (event.wheel || (event.button & 3) !== 0 || event.raw?.endsWith("m")) return;
    const widgetAgent = this.agentForWidgetLine(event.y);
    if (widgetAgent) {
      this.openFooterAgentSession(widgetAgent);
      return;
    }
    if (!this.isFooterStatusLine(event.y)) return;
    const footerAgent = this.currentFooterAgent();
    if (footerAgent) this.openFooterAgentSession(footerAgent);
  }

  private agentForWidgetLine(y: number): Subagent | undefined {
    const line = this.visibleLine(y);
    if (!line) return undefined;
    const clickedName = this.readyWidgetAgents()
      .map((agent) => getDisplayName(agent.type, this.registry))
      .find((name) => line.includes(name));
    if (!clickedName) return undefined;

    const visible = this.visibleLines();
    const clickedIndex = this.visibleLineIndex(y);
    const agentsBeforeClick = visible.slice(0, clickedIndex + 1).filter((candidate) => candidate.includes(clickedName)).length;
    return this.readyWidgetAgents()
      .filter((agent) => getDisplayName(agent.type, this.registry) === clickedName)
      [Math.max(0, agentsBeforeClick - 1)];
  }

  private readyWidgetAgents(): Subagent[] {
    const agents = this.listBackgroundAgents().filter((agent) => agent.isSessionReady());
    const finished = agents.filter((agent) => agent.status !== "running" && agent.status !== "queued" && agent.completedAt && this.shouldShowFinished(agent.id, agent.status));
    const running = agents.filter((agent) => agent.status === "running");
    return [...finished, ...running];
  }

  private visibleLine(y: number): string | undefined {
    return this.visibleLines()[this.visibleLineIndex(y)];
  }

  private visibleLineIndex(y: number): number {
    return y - 1;
  }

  private visibleLines(): string[] {
    const previousLines = Array.isArray(this.tui?.previousLines) ? this.tui.previousLines as string[] : [];
    const rows = Number(this.tui?.terminal?.rows) || previousLines.length;
    const viewportTop = Number.isFinite(this.tui?.previousViewportTop)
      ? Number(this.tui.previousViewportTop)
      : Math.max(0, previousLines.length - rows);
    return previousLines.slice(viewportTop, viewportTop + rows).map(stripAnsi);
  }

  private isFooterStatusLine(y: number): boolean {
    if (!this.lastStatusText) return false;
    const previousLines = Array.isArray(this.tui?.previousLines) ? this.tui.previousLines as string[] : undefined;
    if (!previousLines) return false;
    const rows = Number(this.tui?.terminal?.rows) || previousLines.length;
    const viewportTop = Number.isFinite(this.tui?.previousViewportTop)
      ? Number(this.tui.previousViewportTop)
      : Math.max(0, previousLines.length - rows);
    const line = previousLines[viewportTop + y - 1];
    return Boolean(line && stripAnsi(line).includes(this.lastStatusText));
  }

  private currentFooterAgent(): Subagent | undefined {
    const ready = this.listBackgroundAgents().filter((agent) => agent.isSessionReady());
    return ready.find((agent) => agent.status === "running")
      ?? ready.find((agent) => agent.status === "queued")
      ?? ready.at(-1);
  }

  private openFooterAgentSession(agent: Subagent): void {
    if (!this.uiCtx || this.openingSession || !agent.isSessionReady()) return;
    this.openingSession = true;
    this.releaseFooterMouseCapture();
    const ui = this.uiCtx;
    void ui.custom<undefined>(
      (tui, theme, _keybindings, done) => new TranscriptOverlay({
        ui,
        tui,
        theme,
        source: liveSource(agent),
        done,
        cwd: process.cwd(),
        markdownTheme: getMarkdownTheme(),
      }),
      { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } },
    ).catch((error: unknown) => {
      ui.notify(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      this.openingSession = false;
      this.ensureFooterMouseCapture();
    });
  }

  /** Force an immediate widget update. */
  update() {
`,
  },
  {
    oldText: `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
`,
    newText: `      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        this.ensureFooterMouseCapture();
        return {
`,
  },
  {
    oldText: `      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
`,
    newText: `      // Widget already registered — just request a re-render of existing components.
      this.ensureFooterMouseCapture();
      this.tui?.requestRender();
`,
  },
  {
    oldText: `    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
`,
    newText: `    this.releaseFooterMouseCapture();
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
`,
  },
];

const footerUpgradeEdits = [
  {
    oldText: `import { ERROR_STATUSES, type Theme } from "#src/ui/display";
import { liveSource } from "#src/ui/session-navigation";
`,
    newText: `import { ERROR_STATUSES, getDisplayName, type Theme } from "#src/ui/display";
import { liveSource } from "#src/ui/session-navigation";
`,
  },
  {
    oldText: `  private handleFooterMouse(event: PiMouseEvent): void {
    if (event.wheel || (event.button & 3) !== 0 || event.raw?.endsWith("m")) return;
    if (!this.isFooterStatusLine(event.y)) return;
    const agent = this.currentFooterAgent();
    if (agent) this.openFooterAgentSession(agent);
  }

  private isFooterStatusLine(y: number): boolean {
`,
    newText: `  private handleFooterMouse(event: PiMouseEvent): void {
    if (event.wheel || (event.button & 3) !== 0 || event.raw?.endsWith("m")) return;
    const widgetAgent = this.agentForWidgetLine(event.y);
    if (widgetAgent) {
      this.openFooterAgentSession(widgetAgent);
      return;
    }
    if (!this.isFooterStatusLine(event.y)) return;
    const footerAgent = this.currentFooterAgent();
    if (footerAgent) this.openFooterAgentSession(footerAgent);
  }

  private agentForWidgetLine(y: number): Subagent | undefined {
    const line = this.visibleLine(y);
    if (!line) return undefined;
    const clickedName = this.readyWidgetAgents()
      .map((agent) => getDisplayName(agent.type, this.registry))
      .find((name) => line.includes(name));
    if (!clickedName) return undefined;

    const visible = this.visibleLines();
    const clickedIndex = this.visibleLineIndex(y);
    const agentsBeforeClick = visible.slice(0, clickedIndex + 1).filter((candidate) => candidate.includes(clickedName)).length;
    return this.readyWidgetAgents()
      .filter((agent) => getDisplayName(agent.type, this.registry) === clickedName)
      [Math.max(0, agentsBeforeClick - 1)];
  }

  private readyWidgetAgents(): Subagent[] {
    const agents = this.listBackgroundAgents().filter((agent) => agent.isSessionReady());
    const finished = agents.filter((agent) => agent.status !== "running" && agent.status !== "queued" && agent.completedAt && this.shouldShowFinished(agent.id, agent.status));
    const running = agents.filter((agent) => agent.status === "running");
    return [...finished, ...running];
  }

  private visibleLine(y: number): string | undefined {
    return this.visibleLines()[this.visibleLineIndex(y)];
  }

  private visibleLineIndex(y: number): number {
    return y - 1;
  }

  private visibleLines(): string[] {
    const previousLines = Array.isArray(this.tui?.previousLines) ? this.tui.previousLines as string[] : [];
    const rows = Number(this.tui?.terminal?.rows) || previousLines.length;
    const viewportTop = Number.isFinite(this.tui?.previousViewportTop)
      ? Number(this.tui.previousViewportTop)
      : Math.max(0, previousLines.length - rows);
    return previousLines.slice(viewportTop, viewportTop + rows).map(stripAnsi);
  }

  private isFooterStatusLine(y: number): boolean {
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

function revertLegacyClickPatch(source) {
  if (!source.includes(LEGACY_MARKER)) return { source, reverted: false, missing: [] };
  const reverse = [...legacyClickEdits].reverse().map((edit) => ({ oldText: edit.newText, newText: edit.oldText }));
  const result = applyEdits(source, reverse);
  return { source: result.missing.length === 0 ? result.source : source, reverted: result.missing.length === 0, missing: result.missing };
}

function patchSource(source) {
  const legacy = revertLegacyClickPatch(source);
  if (legacy.missing.length > 0) return { source, status: "skipped", missing: legacy.missing };
  if (legacy.source.includes(PATCH_MARKER)) return { source: legacy.source, status: legacy.reverted ? "reverted-already-patched" : "already-patched" };
  if (legacy.source.includes(FOOTER_ONLY_MARKER)) {
    const upgrade = applyEdits(legacy.source, footerUpgradeEdits);
    if (upgrade.missing.length > 0) return { source: legacy.source, status: "skipped", missing: upgrade.missing };
    return { source: upgrade.source, status: legacy.reverted ? "reverted-and-patched" : "upgraded" };
  }

  const result = applyEdits(legacy.source, footerEdits);
  if (result.missing.length > 0) return { source: legacy.source, status: "skipped", missing: result.missing };
  return { source: result.source, status: legacy.reverted ? "reverted-and-patched" : "patched" };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-subagents footer click patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched" || result.status === "upgraded" || result.status === "reverted-and-patched" || result.status === "reverted-already-patched") {
    fs.writeFileSync(file, result.source);
    log(`[ai-harnesses] patched pi-subagents footer click-to-open`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-subagents footer click patch skipped; upstream file shape changed`);
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET };
