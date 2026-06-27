const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/ui/session-navigator.ts",
);

const PATCH_MARKER = "function piMouseCapture()";

const edits = [
  {
    oldText: `export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: OverlayComponentFactory<R>, options?: unknown): Promise<R>;
}
`,
    newText: `export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: OverlayComponentFactory<R>, options?: unknown): Promise<R>;
  onTerminalInput?(handler: (data: string) => { consume?: boolean } | undefined): () => void;
}

type PiMouseWheelEvent = { delta?: number; deltaY?: number };

function piMouseCapture(): ((args: {
  ui: SessionNavigatorUI;
  tui: TUI;
  onWheel: (event: PiMouseWheelEvent) => void;
}) => () => void) | undefined {
  const capture = (globalThis as { piMouse?: { capture?: unknown } }).piMouse?.capture;
  return typeof capture === "function" ? capture as (args: {
    ui: SessionNavigatorUI;
    tui: TUI;
    onWheel: (event: PiMouseWheelEvent) => void;
  }) => () => void : undefined;
}
`,
  },
  {
    oldText: `  /** Reads a persisted session file for the file-snapshot source. */
  readFile: (path: string) => string;
}
`,
    newText: `  /** Reads a persisted session file for the file-snapshot source. */
  readFile: (path: string) => string;
}
`,
  },
  {
    oldText: `export interface TranscriptOverlayOptions {
  tui: TUI;
  theme: Theme;
`,
    newText: `export interface TranscriptOverlayOptions {
  ui: SessionNavigatorUI;
  tui: TUI;
  theme: Theme;
`,
  },
  {
    oldText: `      (tui, theme, _keybindings, done) =>
        new TranscriptOverlay({ tui, theme, source, done, cwd, markdownTheme }),
`,
    newText: `      (tui, theme, _keybindings, done) =>
        new TranscriptOverlay({ ui, tui, theme, source, done, cwd, markdownTheme }),
`,
  },
  {
    oldText: `  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
`,
    newText: `  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private releaseMouse: (() => void) | undefined;
  private closed = false;

  private readonly ui: SessionNavigatorUI;
  private readonly tui: TUI;
`,
  },
  {
    oldText: `  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.tui = tui;
`,
    newText: `  constructor({ ui, tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.ui = ui;
    this.tui = tui;
`,
  },
  {
    oldText: `    this.unsubscribe = source.subscribe(() => {
      if (this.closed) return;
      this.content = this.rebuild();
      this.tui.requestRender();
    });
  }
`,
    newText: `    this.unsubscribe = source.subscribe(() => {
      if (this.closed) return;
      this.content = this.rebuild();
      this.tui.requestRender();
    });
    this.releaseMouse = piMouseCapture()?.({
      ui: this.ui,
      tui: this.tui,
      onWheel: (event) => {
        const delta = event.deltaY ?? event.delta ?? 0;
        if (delta === 0) return;
        this.scrollBy(delta);
      },
    });
  }
`,
  },
  {
    oldText: `    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }
`,
    newText: `    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.releaseMouse?.();
      this.releaseMouse = undefined;
      this.done(undefined);
      return;
    }
`,
  },
  {
    oldText: `  render(width: number): string[] {
`,
    newText: `  private scrollBy(delta: number): void {
    const totalLines = this.buildContentLines(this.innerWidth()).length;
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewportHeight);
    this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollOffset + delta));
    this.autoScroll = this.scrollOffset >= maxScroll;
    this.tui.requestRender();
  }

  render(width: number): string[] {
`,
  },
  {
    oldText: `  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
`,
    newText: `  dispose(): void {
    this.closed = true;
    this.releaseMouse?.();
    this.releaseMouse = undefined;
    if (this.unsubscribe) {
`,
  },
];

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return { source, changed: false, missing: true };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  return { source: source.slice(0, first) + newText + source.slice(first + oldText.length), changed: true, missing: false };
}

function patchSource(source) {
  if (source.includes(PATCH_MARKER)) return { source, status: "already-patched" };

  let next = source;
  const missing = [];
  for (const edit of edits) {
    if (edit.oldText === edit.newText) continue;
    const result = replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) missing.push(edit.oldText.slice(0, 80));
    next = result.source;
  }

  if (missing.length > 0) {
    return { source, status: "skipped", missing };
  }
  return { source: next, status: "patched" };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-subagents mouse patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched") {
    fs.writeFileSync(file, result.source);
    log(`[ai-harnesses] patched pi-subagents session overlay mouse scrolling`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-subagents mouse patch skipped; upstream file shape changed`);
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET };
