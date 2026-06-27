const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const OPEN_KEY = Symbol.for("@blackhat/pi-subagents:openTranscript");
const WIDGET_KEY = "subagent-click-capture";

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
}

function service() {
  return globalThis[SERVICE_KEY];
}

function opener() {
  return globalThis[OPEN_KEY];
}

function visibleLines(tui) {
  const previous = Array.isArray(tui?.previousLines) ? tui.previousLines : [];
  const rows = Number(tui?.terminal?.rows) || previous.length;
  const top = Number.isFinite(tui?.previousViewportTop) ? Number(tui.previousViewportTop) : Math.max(0, previous.length - rows);
  return previous.slice(top, top + rows).map(stripAnsi);
}

function activeAgents() {
  const agents = service()?.listAgents?.() || [];
  return agents.filter((agent) => agent && (agent.status === "running" || agent.status === "queued"));
}

function agentForLine(line) {
  const text = stripAnsi(line);
  if (!text || !text.includes("Agents")) {
    const agents = activeAgents();
    return agents.find((agent) => text.includes(agent.type) && text.includes(agent.description))
      || agents.find((agent) => text.includes(agent.description))
      || agents.find((agent) => text.includes(agent.type));
  }
  return activeAgents()[0];
}

function install(pi) {
  let ui;
  let cwd = process.cwd();
  let tui;
  let releaseMouse;
  let releaseInput;
  let mounted = false;
  let opening = false;

  const teardownMouse = () => {
    releaseInput?.();
    releaseInput = undefined;
    releaseMouse?.();
    releaseMouse = undefined;
  };

  const refreshMouse = () => {
    const mouse = globalThis.piMouse;
    if (!ui || !tui || !mouse?.enable || !mouse?.parseMouse || !service()?.hasRunning?.()) {
      teardownMouse();
      return;
    }
    if (releaseMouse) return;

    releaseMouse = mouse.enable(tui);
    releaseInput = ui.onTerminalInput?.((data) => {
      if (!mouse.isMouseEvent?.(data)) return undefined;
      const event = mouse.parseMouse(data);
      if (!event || event.wheel || (event.button & 3) !== 0 || String(event.raw || data).endsWith("m")) {
        return { consume: true };
      }
      const line = visibleLines(tui)[event.y - 1];
      const agent = agentForLine(line);
      const open = opener();
      if (agent && typeof open === "function" && !opening) {
        opening = true;
        try {
          open(agent.id, ui, cwd);
        } finally {
          setTimeout(() => {
            opening = false;
          }, 250);
        }
      }
      return { consume: true };
    });
  };

  const mountTuiProbe = () => {
    if (!ui || mounted) return;
    mounted = true;
    ui.setWidget?.(WIDGET_KEY, (nextTui) => {
      tui = nextTui;
      refreshMouse();
      return { render: () => [], invalidate: () => {} };
    }, { placement: "aboveEditor" });
  };

  const captureContext = (_event, ctx) => {
    ui = ctx.ui;
    cwd = ctx.cwd || cwd;
    mountTuiProbe();
    refreshMouse();
  };

  pi.on?.("session_start", captureContext);
  pi.on?.("tool_execution_start", captureContext);
  pi.on?.("session_shutdown", () => {
    teardownMouse();
    if (ui) ui.setWidget?.(WIDGET_KEY, undefined);
    ui = undefined;
    tui = undefined;
    mounted = false;
  });

  const refresh = () => setTimeout(refreshMouse, 0);
  pi.events?.on?.("subagents:created", refresh);
  pi.events?.on?.("subagents:started", refresh);
  pi.events?.on?.("subagents:completed", refresh);
  pi.events?.on?.("subagents:failed", refresh);
}

module.exports = install;
