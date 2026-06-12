const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".pi/agent/readonly-bash.json");
const DEFAULT_TIMEOUT_MS = 1000;

function createReadonlyBashClassifier(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const execPrepare = options.execPrepare || execPrepareDefault;

  return function readonlyBashClassifier(pi) {
    pi.on("tool_call", async (event, ctx = {}) => {
      if (event.toolName !== "bash") return undefined;
      const command = event.input && event.input.command;
      if (typeof command !== "string") return undefined;

      let config;
      try {
        config = loadConfig(configPath);
      } catch {
        return undefined;
      }

      if (firstRunnableShellWord(command) === config.runnerPath) {
        return { block: true, reason: "Direct readonly-bash runner invocation is not allowed" };
      }

      const request = buildPrepareRequest(config, event, ctx, command);
      let response;
      try {
        response = await execPrepare(config.cliPath, request, config.prepareTimeoutMs || DEFAULT_TIMEOUT_MS);
      } catch {
        return undefined;
      }

      if (!response || response.action !== "rewrite" || typeof response.command !== "string") {
        return undefined;
      }
      event.input.command = `READONLY_BASH_REQUEST_ID=${shellQuote(String(event.toolCallId))} ${response.command}`;
      return undefined;
    });
  };
}

function loadConfig(configPath) {
  return JSON.parse(fs.readFileSync(expandPath(configPath), "utf8"));
}

function expandPath(pathValue) {
  if (typeof pathValue !== "string" || pathValue === "") return pathValue;
  const home = os.homedir();
  if (pathValue === "~" || pathValue === "$HOME" || pathValue === "${HOME}") return home;
  for (const prefix of ["~/", "$HOME/", "${HOME}/"]) {
    if (pathValue.startsWith(prefix)) return path.join(home, pathValue.slice(prefix.length));
  }
  return pathValue;
}

function buildPrepareRequest(config, event, ctx, command) {
  const cwd = ctx.cwd || process.cwd();
  const settings = mergeSettings(readJSON(expandPath(config.globalSettingsPath)) || {}, readJSON(projectSettingsPath(config, cwd)) || {});
  return {
    requestID: event.toolCallId,
    cwd,
    command,
    runnerPath: config.runnerPath,
    trustedShell: config.trustedShell,
    trustedPath: config.trustedPath,
    approvalDir: config.approvalDir,
    guard: {
      dangerousEnv: dangerousEnv(process.env),
      shellCommandPrefix: settings.shellCommandPrefix || "",
      shellPath: settings.shellPath || "",
      expectedShellPath: config.trustedShell,
      host: "pi",
    },
  };
}

function projectSettingsPath(config, cwd) {
  if (config.projectSettingsLookup !== "cwd") return undefined;
  return path.join(cwd, ".pi", "settings.json");
}

function mergeSettings(globalSettings, projectSettings) {
  return { ...globalSettings, ...projectSettings };
}

function readJSON(file) {
  if (!file) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function dangerousEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (key === "BASH_ENV" || key === "ENV" || key === "SHELLOPTS" || key === "BASHOPTS" || key.startsWith("BASH_FUNC_")) {
      out[key] = String(value);
    }
  }
  return out;
}

function execPrepareDefault(cliPath, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const child = execFile(cliPath, ["prepare"], { signal: controller.signal, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function firstShellWord(command) {
  return readShellWord(command, 0).word;
}

function firstRunnableShellWord(command) {
  let offset = 0;
  for (;;) {
    const parsed = readShellWord(command, offset);
    if (!parsed.word) return "";
    if (!isShellEnvAssignment(parsed.word)) return parsed.word;
    offset = parsed.end;
  }
}

function readShellWord(command, offset) {
  let i = offset;
  while (i < command.length && /\s/.test(command[i])) i++;
  let word = "";
  let quote = null;
  for (; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === "\\" && i + 1 < command.length) {
        word += command[++i];
      } else {
        word += ch;
      }
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      word += command[++i];
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch) || ch === ";" || ch === "|" || ch === "&" || ch === "<" || ch === ">") break;
    word += ch;
  }
  return { word, end: i };
}

function isShellEnvAssignment(word) {
  const eq = word.indexOf("=");
  if (eq <= 0) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(word.slice(0, eq));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const factory = createReadonlyBashClassifier();
module.exports = factory;
module.exports.createReadonlyBashClassifier = createReadonlyBashClassifier;
module.exports.buildPrepareRequest = buildPrepareRequest;
module.exports.dangerousEnv = dangerousEnv;
module.exports.execPrepareDefault = execPrepareDefault;
module.exports.expandPath = expandPath;
module.exports.firstShellWord = firstShellWord;
module.exports.mergeSettings = mergeSettings;
module.exports.projectSettingsPath = projectSettingsPath;
