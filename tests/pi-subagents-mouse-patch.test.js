const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { patchFile, patchSource } = require("../files/patch-pi-subagents-mouse.js");

const source = `export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: OverlayComponentFactory<R>, options?: unknown): Promise<R>;
}

  /** Reads a persisted session file for the file-snapshot source. */
  readFile: (path: string) => string;
}

export interface TranscriptOverlayOptions {
  tui: TUI;
  theme: Theme;
}

      (tui, theme, _keybindings, done) =>
        new TranscriptOverlay({ tui, theme, source, done, cwd, markdownTheme }),

  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;

  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.tui = tui;
  }

    this.unsubscribe = source.subscribe(() => {
      if (this.closed) return;
      this.content = this.rebuild();
      this.tui.requestRender();
    });
  }

    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

  render(width: number): string[] {
    return [];
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
`;

test("patchSource adds scoped piMouse wheel scrolling", () => {
  const result = patchSource(source);
  assert.equal(result.status, "patched");
  assert.match(result.source, /function piMouseCapture\(\)/);
  assert.match(result.source, /onTerminalInput\?/);
  assert.match(result.source, /new TranscriptOverlay\(\{ ui, tui, theme, source, done, cwd, markdownTheme \}\)/);
  assert.match(result.source, /this\.releaseMouse = piMouseCapture\(\)\?\.\(/);
  assert.match(result.source, /private scrollBy\(delta: number\): void/);
  assert.match(result.source, /this\.releaseMouse\?\.\(\);/);
});

test("patchSource is idempotent", () => {
  const first = patchSource(source);
  const second = patchSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

test("patchFile patches a file once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-mouse-patch-"));
  const file = path.join(dir, "session-navigator.ts");
  fs.writeFileSync(file, source);

  const logs = [];
  assert.equal(patchFile(file, (message) => logs.push(message)), "patched");
  assert.match(fs.readFileSync(file, "utf8"), /function piMouseCapture\(\)/);
  assert.equal(patchFile(file, (message) => logs.push(message)), "already-patched");
  assert.ok(logs.some((message) => message.includes("patched pi-subagents")));
});
