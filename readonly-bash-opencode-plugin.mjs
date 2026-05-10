import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".pi/agent/readonly-bash.json");
const DEFAULT_TIMEOUT_MS = 1000;

export function createReadonlyBashOpenCodePlugin(options = {}) {
  const configPath = options.configPath || process.env.READONLY_BASH_CONFIG || DEFAULT_CONFIG_PATH;
  const execClassify = options.execClassify || execClassifyDefault;

  return async function readonlyBashOpenCodePlugin(ctx = {}) {
    const client = options.client || ctx.client;
    const directory = ctx.directory || process.cwd();

    return {
      event: async ({ event } = {}) => {
        if (!client || event?.type !== "permission.asked") return;
        const request = event.properties || {};
        if (request.permission !== "bash" || !Array.isArray(request.patterns) || request.patterns.length === 0) return;

        let config;
        try {
          config = loadConfig(configPath);
        } catch {
          return;
        }

        for (const command of request.patterns) {
          let response;
          try {
            response = await execClassify(config.cliPath, { command, cwd: directory }, config.prepareTimeoutMs || DEFAULT_TIMEOUT_MS);
          } catch {
            return;
          }
          if (!response || response.decision !== "readonly") return;
        }

        await replyAllowOnce(client, request, directory);
      },

      "shell.env": async (_input, output = {}) => {
        let config;
        try {
          config = loadConfig(configPath);
        } catch {
          return;
        }
        output.env = {
          ...(output.env || {}),
          PATH: config.trustedPath || process.env.PATH || "",
          BASH_ENV: "",
          ENV: "",
          SHELLOPTS: "",
          BASHOPTS: "",
        };
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("BASH_FUNC_")) output.env[key] = "";
        }
      },
    };
  };
}

function loadConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function replyAllowOnce(client, request, directory) {
  if (client.postSessionIdPermissionsPermissionId) {
    await client.postSessionIdPermissionsPermissionId({
      path: { id: request.sessionID, permissionID: request.id },
      query: { directory },
      body: { response: "once" },
    });
    return;
  }
  if (client.permission?.reply) {
    await client.permission.reply({ requestID: request.id, directory, reply: "once" });
    return;
  }
  if (client.permission?.respond) {
    await client.permission.respond({ sessionID: request.sessionID, permissionID: request.id, directory, response: "once" });
  }
}

export function execClassifyDefault(cliPath, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const child = execFile(cliPath, ["classify"], { signal: controller.signal, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
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

export const ReadonlyBashOpenCodePlugin = createReadonlyBashOpenCodePlugin();

export default {
  id: "readonly-bash",
  server: ReadonlyBashOpenCodePlugin,
};
