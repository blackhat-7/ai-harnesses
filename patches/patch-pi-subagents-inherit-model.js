const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/@gotgenes/pi-subagents/src/config/default-agents.ts",
);

const EXPLORE_START = `  [
    "Explore",`;
const PLAN_START = `  [
    "Plan",`;
const MODEL = `      model: "anthropic/claude-haiku-4-5-20251001",
`;

function patchSource(source) {
  const start = source.indexOf(EXPLORE_START);
  const end = source.indexOf(PLAN_START, start + EXPLORE_START.length);
  if (start === -1 || end === -1) return { source, status: "skipped" };

  const explore = source.slice(start, end);
  if (!explore.includes(MODEL)) {
    return { source, status: explore.includes("      model:") ? "skipped" : "already-patched" };
  }

  return {
    source: source.slice(0, start) + explore.replace(MODEL, "") + source.slice(end),
    status: "patched",
  };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-subagents model patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched") {
    fs.writeFileSync(file, result.source);
    log(`[ai-harnesses] patched Explore to inherit the parent model`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-subagents model patch skipped; upstream file shape changed`);
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET };
