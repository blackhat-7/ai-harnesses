const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createReadonlyBashClassifier, execPrepareDefault, expandPath, firstShellWord } = require("./readonly-bash-classifier.js");

async function loadOpenCodePlugin() {
  return import("./readonly-bash-opencode-plugin.mjs");
}

test("blocks direct runner when first runnable shell word is runner path", async () => {
  const { pi, emit } = fakePi();
  const configPath = writeConfig(tdir(), { runnerPath: "/runner" });
  createReadonlyBashClassifier({ configPath, execPrepare: async () => ({ action: "rewrite", command: "/runner" }) })(pi);

  const exact = await emit("tool_call", bashEvent("1", "/runner"));
  assert.equal(exact.block, true);
  const suffix = await emit("tool_call", bashEvent("2", "'/runner' --config /tmp/x"));
  assert.equal(suffix.block, true);
  const escaped = await emit("tool_call", bashEvent("3", "\\/runner --config /tmp/x"));
  assert.equal(escaped.block, true);
  const envPrefixed = await emit("tool_call", bashEvent("4", "READONLY_BASH_REQUEST_ID='x' /runner"));
  assert.equal(envPrefixed.block, true);
});

test("safe calls prepare independently and receive request-id-bound runner commands", async () => {
  const { pi, emit } = fakePi();
  const configPath = writeConfig(tdir(), { runnerPath: "/runner" });
  let calls = 0;
  createReadonlyBashClassifier({
    configPath,
    execPrepare: async () => {
      calls++;
      return { action: "rewrite", command: "/runner" };
    },
  })(pi);

  const first = bashEvent("1", "pwd");
  await emit("tool_call", first, { cwd: "/tmp" });
  assert.equal(first.input.command, "READONLY_BASH_REQUEST_ID='1' /runner");

  const second = bashEvent("2", "pwd");
  await emit("tool_call", second, { cwd: "/tmp" });
  assert.equal(second.input.command, "READONLY_BASH_REQUEST_ID='2' /runner");
  assert.equal(calls, 2);
});

test("maps global and project settings plus dangerous env into guard constraints", async () => {
  const dir = tdir();
  const settingsPath = path.join(dir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ shellPath: "/global/bash", shellCommandPrefix: "" }));
  fs.mkdirSync(path.join(dir, ".pi"));
  fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ shellPath: "/project/bash", shellCommandPrefix: "source x" }));
  const configPath = writeConfig(dir, { globalSettingsPath: settingsPath, trustedShell: "/trusted/bash", projectSettingsLookup: "cwd" });
  const previous = snapshotEnv(["BASH_ENV", "ENV", "BASH_FUNC_x%%", "SHELLOPTS", "BASHOPTS"]);
  process.env.BASH_ENV = path.join(dir, "bash-env");
  process.env.ENV = path.join(dir, "env");
  process.env["BASH_FUNC_x%%"] = "() { :; }";
  process.env.SHELLOPTS = "extglob";
  process.env.BASHOPTS = "globstar";
  let captured;
  try {
    const { pi, emit } = fakePi();
    createReadonlyBashClassifier({
      configPath,
      execPrepare: async (_cli, request) => {
        captured = request;
        return { action: "ask", reason: "test" };
      },
    })(pi);
    await emit("tool_call", bashEvent("abc", "pwd"), { cwd: dir });
  } finally {
    restoreEnv(previous);
  }

  assert.equal(captured.requestID, "abc");
  assert.equal(captured.cwd, dir);
  assert.equal(captured.guard.shellPath, "/project/bash");
  assert.equal(captured.guard.shellCommandPrefix, "source x");
  assert.equal(captured.guard.expectedShellPath, "/trusted/bash");
  assert.equal(captured.guard.dangerousEnv.BASH_ENV, path.join(dir, "bash-env"));
  assert.equal(captured.guard.dangerousEnv.ENV, path.join(dir, "env"));
  assert.equal(captured.guard.dangerousEnv["BASH_FUNC_x%%"], "() { :; }");
  assert.equal(captured.guard.dangerousEnv.SHELLOPTS, "extglob");
  assert.equal(captured.guard.dangerousEnv.BASHOPTS, "globstar");
});

test("mixed safe plus delayed ask still prepares later safe commands", async () => {
  const { pi, emit } = fakePi();
  const configPath = writeConfig(tdir(), { runnerPath: "/runner" });
  let resolveAsk;
  const delayedAsk = new Promise((resolve) => {
    resolveAsk = resolve;
  });
  createReadonlyBashClassifier({
    configPath,
    execPrepare: async (_cli, request) => {
      if (request.requestID === "safe-1") return { action: "rewrite", command: "/runner" };
      if (request.requestID === "ask-1") return delayedAsk;
      return { action: "rewrite", command: "/runner" };
    },
  })(pi);

  const safe1 = bashEvent("safe-1", "pwd");
  await emit("tool_call", safe1, { cwd: "/tmp" });
  assert.equal(safe1.input.command, "READONLY_BASH_REQUEST_ID='safe-1' /runner");

  const ask1 = bashEvent("ask-1", "pwd");
  const askPromise = emit("tool_call", ask1, { cwd: "/tmp" });
  const safe2 = bashEvent("safe-2", "pwd");
  await emit("tool_call", safe2, { cwd: "/tmp" });
  assert.equal(safe2.input.command, "READONLY_BASH_REQUEST_ID='safe-2' /runner");

  resolveAsk({ action: "ask", reason: "delayed" });
  await askPromise;
  assert.equal(ask1.input.command, "pwd");

  const safe3 = bashEvent("safe-3", "pwd");
  await emit("tool_call", safe3, { cwd: "/tmp" });
  assert.equal(safe3.input.command, "READONLY_BASH_REQUEST_ID='safe-3' /runner");
});

test("prepare ask/error responses fail closed without pending lock", async () => {
  const { pi, emit } = fakePi();
  const configPath = writeConfig(tdir(), { runnerPath: "/runner" });
  const responses = [
    { action: "ask", reason: "no" },
    new Error("boom"),
    { action: "rewrite", command: "/runner" },
  ];
  createReadonlyBashClassifier({
    configPath,
    execPrepare: async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  })(pi);

  const first = bashEvent("1", "pwd");
  await emit("tool_call", first);
  assert.equal(first.input.command, "pwd");

  const second = bashEvent("2", "pwd");
  await emit("tool_call", second);
  assert.equal(second.input.command, "pwd");

  const third = bashEvent("3", "pwd");
  await emit("tool_call", third);
  assert.equal(third.input.command, "READONLY_BASH_REQUEST_ID='3' /runner");
});

test("opencode plugin default export uses opencode v1 object shape", async () => {
  const mod = await loadOpenCodePlugin();
  assert.equal(mod.default.id, "readonly-bash");
  assert.equal(typeof mod.default.server, "function");
});

test("opencode plugin auto-approves readonly bash permission without rewriting the command", async () => {
  const mod = await loadOpenCodePlugin();
  const dir = tdir();
  const configPath = writeConfig(dir, { trustedPath: "/trusted/bin" });
  const replies = [];
  const plugin = await mod.createReadonlyBashOpenCodePlugin({
    configPath,
    execClassify: async (_cli, request) => {
      assert.equal(request.cwd, dir);
      assert.equal(request.command, "sed -n '1,24p' flake.nix");
      return { decision: "readonly" };
    },
    client: { postSessionIdPermissionsPermissionId: async (request) => replies.push(request) },
  })({ directory: dir });

  await plugin.event({ event: permissionAsked("perm-1", ["sed -n '1,24p' flake.nix"]) });

  assert.deepEqual(replies, [
    {
      path: { id: "s", permissionID: "perm-1" },
      query: { directory: dir },
      body: { response: "once" },
    },
  ]);
});

test("opencode plugin leaves unsafe bash permissions for opencode to ask", async () => {
  const mod = await loadOpenCodePlugin();
  const dir = tdir();
  const configPath = writeConfig(dir);
  const replies = [];
  const plugin = await mod.createReadonlyBashOpenCodePlugin({
    configPath,
    execClassify: async () => ({ decision: "ask", reason: "no" }),
    client: { permission: { reply: async (request) => replies.push(request) } },
  })({ directory: dir });

  await plugin.event({ event: permissionAsked("perm-1", ["rm -rf /tmp/nope"]) });

  assert.deepEqual(replies, []);
});

test("opencode plugin hardens shell environment for raw command execution", async () => {
  const mod = await loadOpenCodePlugin();
  const dir = tdir();
  const configPath = writeConfig(dir, { trustedPath: "/trusted/bin" });
  const previous = snapshotEnv(["BASH_FUNC_x%%"]);
  process.env["BASH_FUNC_x%%"] = "() { :; }";
  try {
    const plugin = await mod.createReadonlyBashOpenCodePlugin({ configPath })({ directory: dir });
    const output = { env: { KEEP: "1" } };
    await plugin["shell.env"]({}, output);
    assert.equal(output.env.PATH, "/trusted/bin");
    assert.equal(output.env.BASH_ENV, "");
    assert.equal(output.env.ENV, "");
    assert.equal(output.env.SHELLOPTS, "");
    assert.equal(output.env.BASHOPTS, "");
    assert.equal(output.env["BASH_FUNC_x%%"], "");
    assert.equal(output.env.KEEP, "1");
  } finally {
    restoreEnv(previous);
  }
});

test("execPrepareDefault rejects timeout, nonzero, and invalid JSON", async () => {
  const dir = tdir();
  const hang = writeNodeScript(dir, "hang", "setTimeout(() => {}, 5000);");
  await assert.rejects(() => execPrepareDefault(hang, { command: "pwd" }, 10));

  const nonzero = writeNodeScript(dir, "nonzero", "process.exit(7);");
  await assert.rejects(() => execPrepareDefault(nonzero, { command: "pwd" }, 1000));

  const invalid = writeNodeScript(dir, "invalid", "process.stdout.write('not-json');");
  await assert.rejects(() => execPrepareDefault(invalid, { command: "pwd" }, 1000));
});

test("standalone flake exports Home Manager module and keeps unknown bash on ask", () => {
  const defaultNix = fs.readFileSync(path.join(__dirname, "default.nix"), "utf8");
  const piNix = fs.readFileSync(path.join(__dirname, "pi.nix"), "utf8");
  const claudeNix = fs.readFileSync(path.join(__dirname, "claude.nix"), "utf8");
  const opencodeNix = fs.readFileSync(path.join(__dirname, "opencode.nix"), "utf8");
  const mcpServersNix = fs.readFileSync(path.join(__dirname, "mcp-servers.nix"), "utf8");
  const flakeNix = fs.readFileSync(path.join(__dirname, "flake.nix"), "utf8");

  assert.match(flakeNix, /homeManagerModules\.default/);
  assert.match(flakeNix, /_module\.args\.aiHarnessesInputs = inputs;/);
  assert.match(flakeNix, /url = "github:blackhat-7\/readonly-bash\/main";/);
  assert.match(defaultNix, /options\.aiHarnesses =/);
  assert.match(defaultNix, /mode = lib\.mkOption/);
  assert.match(defaultNix, /lib\.types\.enum \[ "restricted" "yolo" \]/);
  assert.match(defaultNix, /default = "restricted";/);
  assert.match(defaultNix, /mcp = \{/);
  assert.match(defaultNix, /enabledServers/);
  assert.match(mcpServersNix, /unknownServers/);
  assert.match(mcpServersNix, /if !mcpEnable then\s*\{ \}/);

  assert.match(piNix, /readonlyBashSrc = aiHarnessesInputs\.readonly-bash;/);
  assert.doesNotMatch(piNix, /readonlyBashSrc = inputs\.readonly-bash;/);
  assert.doesNotMatch(piNix, /\$\{home\}\/[^\"]*readonly-bash-classifier\.js/);
  assert.doesNotMatch(piNix, /builtins\.fetchGit|pkgs\.fetchFromGitHub/);
  assert.doesNotMatch(piNix, /\|\| true/);
  assert.match(piNix, /npm install --global/);
  assert.match(piNix, /pkgs\.git/);
  assert.match(piNix, /pkgs\.git-lfs/);
  assert.match(piNix, /"\$npm_bin\/pi" update --extensions/);
  assert.match(piNix, /lib\.optionals mcpEnabled \[/);
  assert.match(piNix, /"npm:@gotgenes\/pi-subagents"/);
  assert.match(piNix, /"npm:@gotgenes\/pi-permission-system"/);
  assert.match(piNix, /"git:github\.com\/blackhat-7\/pi-dynamic-workflows@permission-prompts"/);
  assert.doesNotMatch(piNix, /"npm:pi-subagents"/);
  assert.doesNotMatch(piNix, /"npm:pi-permission-system"/);
  assert.doesNotMatch(piNix, /patchPiPackage/);
  assert.match(piNix, /helpers\.writeJson "\$HOME\/\.pi\/agent\/subagents\.json" piSubagentsSettings/);
  assert.match(piNix, /rm -f "\$HOME\/\.pi\/agent\/extensions\/readonly-bash-classifier\.js" "\$HOME\/\.pi\/agent\/pi-permissions\.jsonc" "\$HOME\/\.pi\/agent\/extensions\/subagent\/config\.json"/);
  assert.match(piNix, /"\$\{\.\/readonly-bash-classifier\.js\}"/);
  assert.match(piNix, /"\$\{\.\/files\/pi-mouse\.js\}"/);
  assert.match(piNix, /prompts = \[ "~\/\.claude\/commands" \];/);
  assert.match(piNix, /piYoloPermission = \{\s*"\*" = "allow";/);
  assert.match(piNix, /yoloMode = isYolo;/);
  assert.match(piNix, /permission = if isYolo then piYoloPermission else piRestrictedPermission;/);
  assert.match(piNix, /"READONLY_BASH_REQUEST_ID=\* \$\{readonlyBashRunnerCommandString\}" = "allow";/);
  assert.match(piNix, /workflow = "allow";/);
  assert.match(piNix, /web_fetch = "allow";/);
  assert.match(piNix, /structured_output = "allow";/);
  assert.match(piNix, /get_subagent_result = "allow";/);
  assert.match(piNix, /steer_subagent = "allow";/);
  assert.match(piNix, /rm -f "\$HOME\/\.pi\/agent\/extensions\/readonly-bash-classifier\.js"/);
  for (const pkg of ["coreutils", "findutils", "gnugrep", "ripgrep", "git", "file", "gnused", "gawk", "nodejs", "python3"]) {
    assert.match(piNix, new RegExp(`pkgs\\.${pkg}`));
  }

  assert.match(claudeNix, /hasMcp = name:/);
  assert.match(claudeNix, /defaultMode = "bypassPermissions";/);
  assert.doesNotMatch(opencodeNix, /opencodeConfig = \{[\s\S]*?shell = /);
  assert.match(opencodeNix, /bash\."\*" = "allow";/);
  assert.match(opencodeNix, /bash\."\*" = "ask";/);
  assert.match(opencodeNix, /helpers\.copyFile "\$HOME\/\.config\/opencode\/plugins\/readonly-bash\.js" \.\/readonly-bash-opencode-plugin\.mjs/);
});

test("firstShellWord parses quoted and escaped runner paths", () => {
  assert.equal(firstShellWord("  '/runner path' --flag"), "/runner path");
  assert.equal(firstShellWord('/runner; rm -rf /'), "/runner");
  assert.equal(firstShellWord("\\/runner --flag"), "/runner");
});

test("expandPath resolves runtime home paths", () => {
  const previous = snapshotEnv(["HOME"]);
  process.env.HOME = "/tmp/runtime-home";
  try {
    assert.equal(expandPath("~/x"), "/tmp/runtime-home/x");
    assert.equal(expandPath("$HOME/x"), "/tmp/runtime-home/x");
    assert.equal(expandPath("${HOME}/x"), "/tmp/runtime-home/x");
  } finally {
    restoreEnv(previous);
  }
});

function fakePi() {
  const handlers = new Map();
  return {
    pi: { on: (name, handler) => handlers.set(name, handler) },
    emit: async (name, event, ctx = {}) => handlers.get(name)?.(event, ctx),
  };
}

function bashEvent(toolCallId, command) {
  return { toolName: "bash", toolCallId, input: { command } };
}

function permissionAsked(id, patterns) {
  return { type: "permission.asked", properties: { id, sessionID: "s", permission: "bash", patterns, metadata: {} } };
}

function writeConfig(dir, overrides = {}) {
  const config = {
    cliPath: "/bin/readonly-bash",
    runnerPath: "/runner",
    approvalDir: path.join(dir, "approvals"),
    trustedShell: "/bin/bash",
    trustedPath: "/bin:/usr/bin",
    globalSettingsPath: path.join(dir, "settings.json"),
    projectSettingsLookup: "none",
    ...overrides,
  };
  if (!fs.existsSync(config.globalSettingsPath)) {
    fs.writeFileSync(config.globalSettingsPath, JSON.stringify({ shellPath: config.trustedShell, shellCommandPrefix: "" }));
  }
  const configPath = path.join(dir, "readonly-bash.json");
  fs.writeFileSync(configPath, JSON.stringify(config));
  return configPath;
}

function writeNodeScript(dir, name, body) {
  const file = path.join(dir, name + ".js");
  fs.writeFileSync(file, "#!/usr/bin/env node\n" + body + "\n");
  fs.chmodSync(file, 0o700);
  return file;
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function tdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "readonly-bash-js-"));
}
