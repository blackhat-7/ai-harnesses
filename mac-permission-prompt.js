const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROMPT_EVENT = "permissions:ui_prompt";
const ORIGINAL_SELECT = Symbol.for("pi.macPermissionPrompt.originalSelect");
const IS_WRAPPER = Symbol.for("pi.macPermissionPrompt.isWrapper");
const GET_META = Symbol.for("pi.macPermissionPrompt.getMeta");

const DEFAULT_TERMINAL_BUNDLE_ID = "net.kovidgoyal.kitty";
const MAX_BANNER_CHARS = 700;

let lastPermissionPrompt = null;
const unsubs = [];

module.exports = function macPermissionPrompt(pi) {
  if (pi.events && typeof pi.events.on === "function") {
    unsubs.push(
      pi.events.on(PROMPT_EVENT, (payload) => {
        lastPermissionPrompt = { payload, at: Date.now() };
      }),
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    installSelectWrapper(ctx, () => buildMeta(ctx));
  });

  pi.on("tool_call", async (event, ctx) => {
    installSelectWrapper(ctx, () => buildMeta(ctx, event));
  });

  pi.on("session_shutdown", async () => {
    while (unsubs.length > 0) {
      try {
        unsubs.pop()?.();
      } catch {
        // best effort
      }
    }
  });
};

function installSelectWrapper(ctx, getMeta) {
  const ui = ctx && ctx.ui;
  if (!ui || typeof ui.select !== "function") return;

  const current = ui.select;
  if (current[IS_WRAPPER]) {
    current[GET_META] = getMeta;
    return;
  }

  const original = current[ORIGINAL_SELECT] || current.bind(ui);

  async function wrappedSelect(title, options, optionsOverride) {
    if (!isPermissionDecisionOptions(options)) {
      return original(title, options, optionsOverride);
    }

    const request = buildRequest(title, options, wrappedSelect[GET_META]?.() || buildMeta(ctx));
    await sendTerminalNotification(request);

    // Keep permission decisions in Pi's own TUI. This is the last reliable version:
    // macOS banner alerts you and clicking it focuses Kitty; Pi still owns Allow/Deny.
    return original(title, options, optionsOverride);
  }

  wrappedSelect[ORIGINAL_SELECT] = original;
  wrappedSelect[IS_WRAPPER] = true;
  wrappedSelect[GET_META] = getMeta;
  ui.select = wrappedSelect;
}

function isPermissionDecisionOptions(options) {
  if (!Array.isArray(options)) return false;
  const normalized = options.map((option) => String(option).toLowerCase());

  return (
    (normalized.includes("yes") && normalized.includes("no")) ||
    (normalized.some((option) => option.includes("allow")) &&
      normalized.some((option) => option.includes("deny") || option.includes("reject") || option.includes("cancel")))
  );
}

function buildMeta(ctx, event) {
  const prompt = recentPermissionPrompt();
  const promptMatchesTool = !prompt?.requestId || !event || String(prompt.requestId) === String(event.toolCallId);
  const cwd = (ctx && ctx.cwd) || process.cwd();

  return {
    cwd,
    project: path.basename(cwd) || cwd,
    prompt,
    tmux: captureTmuxTarget(),
    tool: event && promptMatchesTool
      ? { id: event.toolCallId, name: event.toolName, input: event.input }
      : null,
  };
}

function recentPermissionPrompt() {
  if (!lastPermissionPrompt || Date.now() - lastPermissionPrompt.at > 10_000) return null;
  return lastPermissionPrompt.payload || null;
}

function buildRequest(title, options, meta) {
  const id = requestId(meta);
  const titleText = String(title || "Permission Required");
  const detailsPath = writeDetailsFile(id, titleText, options, meta);

  return {
    id,
    title: `Pi permission · ${meta.project || "session"}`,
    message: summarizeRequest(titleText, meta),
    detailsPath,
    meta,
  };
}

function requestId(meta) {
  const base = meta?.prompt?.requestId || meta?.tool?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return String(base).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function summarizeRequest(titleText, meta) {
  const surface = meta?.prompt?.surface || meta?.tool?.name || "permission";
  const value = meta?.prompt?.value || toolPreview(meta?.tool) || "permission request";
  const lines = [
    `${surface}: ${oneLine(value, 180)}`,
    `Project: ${meta.project}`,
    meta?.tmux?.label ? `Tmux: ${meta.tmux.label}` : null,
    "",
    truncate(titleText, 330),
    "",
    "Open Pi/Kitty to accept or deny.",
  ].filter(Boolean);

  return truncate(lines.join("\n"), MAX_BANNER_CHARS);
}

function toolPreview(tool) {
  if (!tool) return "";
  if (tool.name === "bash" && typeof tool.input?.command === "string") return `$ ${tool.input.command}`;
  if (typeof tool.input?.path === "string") return tool.input.path;
  return tool.name || "";
}

function writeDetailsFile(id, titleText, options, meta) {
  const dir = promptDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const file = path.join(dir, `${id}.md`);
  const content = [
    "# Pi permission request",
    "",
    `- Created: ${new Date().toISOString()}`,
    `- Project: ${meta.project || "unknown"}`,
    `- CWD: ${meta.cwd || "unknown"}`,
    meta?.tmux?.label ? `- Tmux: ${meta.tmux.label}` : null,
    meta?.prompt?.requestId ? `- Request: ${meta.prompt.requestId}` : null,
    meta?.tool?.name ? `- Tool: ${meta.tool.name}` : null,
    "",
    "## Prompt",
    "```text",
    titleText,
    "```",
    "",
    "## Options",
    "```json",
    JSON.stringify(options, null, 2),
    "```",
    "",
    "## Permission event",
    "```json",
    JSON.stringify(meta.prompt || null, null, 2),
    "```",
    "",
    "## Tool input",
    "```json",
    JSON.stringify(meta.tool || null, null, 2),
    "```",
  ].filter((line) => line !== null).join("\n");

  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

async function sendTerminalNotification(request) {
  logEvent(request, "prompt_started");

  if (process.platform !== "darwin") return;

  const terminalNotifier = findExecutable(process.env.PI_MAC_PERMISSION_TERMINAL_NOTIFIER || "terminal-notifier");
  if (!terminalNotifier) {
    logEvent(request, "terminal_notifier_missing");
    return;
  }

  const args = [
    "-title", request.title,
    "-message", request.message,
    "-group", `pi-permission-${request.id}`,
  ];

  const bundleId = process.env.PI_MAC_PERMISSION_TERMINAL_BUNDLE_ID || DEFAULT_TERMINAL_BUNDLE_ID;
  if (bundleId) args.push("-activate", bundleId);

  try {
    await execFileAsync(terminalNotifier, args, { timeout: 3000 });
    logEvent(request, "notification_sent", { via: "terminal-notifier" });
  } catch (error) {
    logEvent(request, "notification_failed", { via: "terminal-notifier", error: errorMessage(error) });
  }
}

function captureTmuxTarget() {
  if (!process.env.TMUX && !process.env.TMUX_PANE) return null;

  try {
    const stdout = execFileSyncText("tmux", [
      "display-message",
      "-p",
      "#{client_name}\t#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_id}\t#{window_name}",
    ]);
    const [clientName, sessionName, windowIndex, paneIndex, paneId, windowName] = stdout.trim().split("\t");
    const target = sessionName && windowIndex != null && paneIndex != null
      ? `${sessionName}:${windowIndex}.${paneIndex}`
      : paneId || process.env.TMUX_PANE;

    return {
      clientName: clientName || null,
      sessionName: sessionName || null,
      windowIndex: windowIndex || null,
      paneIndex: paneIndex || null,
      paneId: paneId || process.env.TMUX_PANE || null,
      windowName: windowName || null,
      target,
      label: sessionName ? `${sessionName}:${windowIndex}.${paneIndex}${windowName ? ` ${windowName}` : ""}` : target,
    };
  } catch {
    return process.env.TMUX_PANE ? { paneId: process.env.TMUX_PANE, target: process.env.TMUX_PANE, label: process.env.TMUX_PANE } : null;
  }
}

function findExecutable(name) {
  if (!name) return null;
  if (name.includes(path.sep)) return isExecutable(name) ? name : null;

  return [
    ...String(process.env.PATH || "").split(path.delimiter).map((dir) => path.join(dir, name)),
    path.join(os.homedir(), ".local/bin", name),
    path.join(os.homedir(), ".nix-profile/bin", name),
    `/etc/profiles/per-user/${os.userInfo().username}/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ].filter(Boolean).find(isExecutable) || null;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function promptDir() {
  return process.env.PI_MAC_PERMISSION_PROMPT_DIR || path.join(os.homedir(), ".pi/agent/permission-prompts");
}

function logEvent(request, event, extra = {}) {
  try {
    const dir = promptDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(dir, "log.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        requestId: request.id,
        project: request.meta?.project,
        cwd: request.meta?.cwd,
        tmux: request.meta?.tmux,
        detailsPath: request.detailsPath,
        ...extra,
      }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // Logging must never affect permission handling.
  }
}

function truncate(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 16))}\n… [truncated]`;
}

function oneLine(text, max) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), max);
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function execFileSyncText(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function errorMessage(error) {
  const message = error && error.message ? String(error.message) : String(error);
  const stderr = error && error.stderr ? String(error.stderr) : "";
  return stderr ? `${message}\n${stderr}` : message;
}

module.exports._private = {
  isPermissionDecisionOptions,
  summarizeRequest,
  captureTmuxTarget,
};
