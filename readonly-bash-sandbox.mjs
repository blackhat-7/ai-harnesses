#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const [modulePath, ...args] = process.argv.slice(2);
const separator = args.indexOf("--");
const settingsIndex = args.indexOf("--settings");
if (!modulePath || settingsIndex < 0 || !args[settingsIndex + 1] || separator < 0 || separator === args.length - 1) {
  throw new Error("usage: readonly-bash-sandbox MODULE --settings FILE -- COMMAND [ARG...]");
}

const { SandboxManager, SandboxRuntimeConfigSchema } = await import(modulePath);
const settings = JSON.parse(await readFile(args[settingsIndex + 1], "utf8"));
const config = SandboxRuntimeConfigSchema.parse({
  ...settings,
  network: { allowedDomains: [], deniedDomains: ["*"] },
});
// SRT enables network filtering only when allowedDomains is present.
delete config.network.allowedDomains;
config.network.deniedDomains = [];

await SandboxManager.initialize(config);
const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const command = args.slice(separator + 1).map(quote).join(" ");
const { argv, env } = await SandboxManager.wrapWithSandboxArgv(command, args[separator + 1]);
const child = spawn(argv[0], argv.slice(1), { env, shell: false, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (!signal) process.exit(code ?? 1);
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
});
