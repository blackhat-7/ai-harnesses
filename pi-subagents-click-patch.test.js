const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { patchFile, patchSource } = require("./files/patch-pi-subagents-click.js");

const source = `import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Subagent } from "#src/lifecycle/subagent";
import type { SubagentManager, SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { CompactionInfo } from "#src/types";
import { ERROR_STATUSES, type Theme } from "#src/ui/display";
import { renderWidgetLines, type WidgetAgent } from "#src/ui/widget-renderer";

export type UICtx = {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
};

export class AgentWidget implements SubagentManagerObserver {
  private uiCtx: UICtx | undefined;
  private widgetFrame = 0;
  private widgetInterval: ReturnType<typeof setInterval> | undefined;
  private finishedTurnAge = new Map<string, number>();
  private static readonly ERROR_LINGER_TURNS = 2;

  private widgetRegistered = false;
  /** Cached TUI reference from widget factory callback, used for requestRender(). */
  private tui: any | undefined;
  /** Last status bar text, used to avoid redundant setStatus calls. */
  private lastStatusText: string | undefined;

  constructor(
    private manager: SubagentManager,
    private registry: AgentTypeRegistry,
  ) {}

  setUICtx(ctx: UICtx) {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
    }
  }

  private listBackgroundAgents(): Subagent[] { return []; }
  private toWidgetAgent(record: Subagent): WidgetAgent { return record as unknown as WidgetAgent; }
  private renderWidget(tui: any, theme: Theme): string[] { return []; }

  private clearWidget(backgroundAgents: readonly { id: string }[]): void {
    if (this.widgetRegistered) {
      this.uiCtx!.setWidget("agents", undefined);
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  private seedFinishedAgents(agents: readonly { completedAt?: number; id: string }[]): void {}

  /** Force an immediate widget update. */
  update() {
    if (!this.uiCtx) return;
    if (!this.widgetRegistered) {
      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
            this.widgetRegistered = false;
            this.tui = undefined;
          },
        };
      }, { placement: "aboveEditor" });
      this.widgetRegistered = true;
    } else {
      // Widget already registered — just request a re-render of existing components.
      this.tui?.requestRender();
    }
  }

  dispose() {
    if (this.widgetInterval) {
      clearInterval(this.widgetInterval);
      this.widgetInterval = undefined;
    }
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
    this.widgetRegistered = false;
    this.tui = undefined;
    this.lastStatusText = undefined;
  }
}
`;

test("patchSource adds click-to-open support to the agents widget", () => {
  const result = patchSource(source);
  assert.equal(result.status, "patched");
  assert.match(result.source, /function piMouseCapture\(\)/);
  assert.match(result.source, /TranscriptOverlay/);
  assert.match(result.source, /liveSource\(agent\)/);
  assert.match(result.source, /private clickedLine\(y: number\)/);
  assert.match(result.source, /private openAgentSession\(agent: Subagent\)/);
  assert.match(result.source, /this\.ensureMouseCapture\(\)/);
  assert.match(result.source, /this\.releaseMouseCapture\(\)/);
});

test("patchSource is idempotent", () => {
  const first = patchSource(source);
  const second = patchSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

test("patchFile patches a file once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-click-patch-"));
  const file = path.join(dir, "agent-widget.ts");
  fs.writeFileSync(file, source);

  const logs = [];
  assert.equal(patchFile(file, (message) => logs.push(message)), "patched");
  assert.match(fs.readFileSync(file, "utf8"), /function piMouseCapture\(\)/);
  assert.equal(patchFile(file, (message) => logs.push(message)), "already-patched");
  assert.ok(logs.some((message) => message.includes("widget click-to-open")));
});
