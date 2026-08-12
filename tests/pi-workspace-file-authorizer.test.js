const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const workspaceFileAuthorizer = require("../pi-workspace-file-authorizer.js");
const {
  classifyFileEdit,
  pathPreview,
  targetsGit,
} = workspaceFileAuthorizer;

function details(toolName, target) {
  return {
    toolName,
    accessIntent: {
      matchValues: [target],
      boundaryValue: target,
    },
  };
}

test("allows file-editing tools in the workspace and /tmp", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-authorizer-"));
  for (const [toolName, target] of [
    ["edit", "src/app.ts"],
    ["write", path.join(root, "new.txt")],
    ["ctx_edit", "/tmp/ctx-edit.txt"],
    ["ctx_patch", "README.md"],
  ]) {
    assert.deepEqual(classifyFileEdit(details(toolName, target), root), {
      kind: "allow",
    });
  }
});

test("denies .git and defers .env or external edits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-authorizer-"));
  const outside = fs.mkdtempSync(path.join(os.homedir(), ".workspace-authorizer-"));

  assert.deepEqual(classifyFileEdit(details("edit", ".git/config"), root), {
    kind: "deny",
    reason: "Editing .git is not allowed",
  });
  assert.deepEqual(classifyFileEdit(details("write", ".env"), root), {
    kind: "defer",
  });
  assert.deepEqual(classifyFileEdit(details("write", ".env.example"), root), {
    kind: "allow",
  });
  fs.writeFileSync(path.join(root, ".env"), "SECRET=value\n");
  fs.symlinkSync(path.join(root, ".env"), path.join(root, "env-link"));
  assert.deepEqual(classifyFileEdit(details("edit", "env-link"), root), {
    kind: "defer",
  });
  assert.deepEqual(
    classifyFileEdit(details("ctx_patch", path.join(outside, "file")), root),
    { kind: "defer" },
  );
});

test("resolves symlinks before applying workspace scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-authorizer-"));
  const outside = fs.mkdtempSync(path.join(os.homedir(), ".workspace-authorizer-"));
  fs.symlinkSync(outside, path.join(root, "escape"));

  assert.deepEqual(
    classifyFileEdit(details("write", "escape/new.txt"), root),
    { kind: "defer" },
  );
});

test("recognizes lexical and symlinked .git targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-authorizer-"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.symlinkSync(path.join(root, ".git"), path.join(root, "git-link"));

  assert.equal(targetsGit(".git/config", root), true);
  assert.equal(targetsGit("git-link/config", root), true);
  assert.equal(targetsGit("src/git.js", root), false);
});

test("uses an exact path preview for extension edit tools", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-authorizer-"));
  const target = 'src/a "quoted" file.ts';
  const toolInputPreview = pathPreview({ path: target });

  assert.deepEqual(
    classifyFileEdit({ surface: "ctx_edit", toolInputPreview }, root),
    { kind: "allow" },
  );
  assert.equal(pathPreview({}), undefined);
});

test("registers the configured authorizer when permissions are ready", () => {
  const events = new EventEmitter();
  const handlers = new Map();
  const registered = [];
  const serviceKey = Symbol.for("@gotgenes/pi-permission-system:service");
  globalThis[serviceKey] = {
    registerToolInputFormatter(name) {
      registered.push(name);
      return () => {};
    },
    registerAuthorizer(name) {
      registered.push(name);
      return () => {};
    },
  };

  workspaceFileAuthorizer({
    events,
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  handlers.get("session_start")({}, { cwd: "/workspace" });
  events.emit("permissions:ready");

  assert.deepEqual(registered, ["ctx_edit", "ctx_patch", "workspace-file-edits"]);
  handlers.get("session_shutdown")();
  delete globalThis[serviceKey];
});

test("shares registrations across parent and subagent extension instances", async () => {
  const emitter = new EventEmitter();
  const events = {
    emit: (...args) => emitter.emit(...args),
    on(name, handler) {
      emitter.on(name, handler);
      return () => emitter.off(name, handler);
    },
  };
  const serviceKey = Symbol.for("@gotgenes/pi-permission-system:service");
  const formatters = new Set();
  const authorizers = new Map();
  const registrations = [];
  globalThis[serviceKey] = {
    registerToolInputFormatter(name) {
      if (formatters.has(name)) throw new Error(`duplicate formatter: ${name}`);
      formatters.add(name);
      registrations.push(name);
      return () => formatters.delete(name);
    },
    registerAuthorizer(name, authorize) {
      if (authorizers.has(name)) throw new Error(`duplicate authorizer: ${name}`);
      authorizers.set(name, authorize);
      registrations.push(name);
      return () => authorizers.delete(name);
    },
  };

  const bind = (cwd) => {
    const handlers = new Map();
    workspaceFileAuthorizer({
      events,
      on(name, handler) {
        handlers.set(name, handler);
      },
    });
    handlers.get("session_start")({}, { cwd });
    return handlers;
  };

  const parent = bind("/workspace");
  events.emit("permissions:ready");
  const child = bind("/child");
  events.emit("permissions:ready");

  assert.deepEqual(registrations, ["ctx_edit", "ctx_patch", "workspace-file-edits"]);
  assert.deepEqual(
    await authorizers.get("workspace-file-edits")(
      details("ctx_edit", "/workspace/file"),
      undefined,
      { review() {} },
    ),
    { kind: "allow" },
  );

  child.get("session_shutdown")();
  assert.equal(authorizers.has("workspace-file-edits"), true);
  parent.get("session_shutdown")();
  assert.equal(formatters.size, 0);
  assert.equal(authorizers.size, 0);
  delete globalThis[serviceKey];
});
