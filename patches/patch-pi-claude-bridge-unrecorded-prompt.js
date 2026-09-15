const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/pi-claude-bridge/src/prompt-capture.ts",
);

const PATCH_MARKER = "ai-harnesses: forward unrecorded system prompts";

// pi-automode's permission classifier calls the provider's streamSimple with a
// system prompt it builds itself, so `before_agent_start` never records it and
// resolveOrDerive matches neither an exact key nor an embedded one. Upstream
// throws there, automode fails closed, and every tool call is blocked.
//
// Carrying the prompt through as `custom` loses nothing: it is the caller's whole
// instruction set, and an unrecorded prompt has no pi context files or skills
// behind it to drop. It lands as an append on Claude Code's preset, which is what
// a one-shot completion wants. Recorded prompts never reach this branch.
const oldText = [
  "\t\tif (embedded.length === 0) {",
  "\t\t\tthrow new Error(",
  "\t\t\t\t`prompt-capture: no capture for this ${systemPrompt.length}-char system prompt, and it embeds none of the ${this.captures.size} known. `",
  "\t\t\t\t+ `Claude Code would receive none of this turn's context files, skills or custom instructions. `",
  "\t\t\t\t+ `The usual cause is an extension loaded after claude-bridge that rewrites the system prompt from before_agent_start — `",
  "\t\t\t\t+ `one that wraps it is fine, one that rebuilds or strips it leaves nothing to match.`,",
  "\t\t\t);",
  "\t\t}",
  "",
].join("\n");

const newText = [
  "\t\tif (embedded.length === 0) {",
  `\t\t\t// ${PATCH_MARKER}: pi-automode's classifier builds its own prompt, which`,
  "\t\t\t// before_agent_start never records. Throwing here makes automode fail closed and",
  "\t\t\t// block every tool call. An unrecorded prompt has no pi context files or skills",
  "\t\t\t// behind it, so carrying it through as `custom` drops nothing.",
  "\t\t\treturn { assembledPrompt: systemPrompt, custom: systemPrompt, contextFiles: [], skills: [], inherited: [] };",
  "\t\t}",
  "",
].join("\n");

const edits = [{ oldText, newText }];

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return { source, changed: false, missing: true };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  return { source: source.slice(0, first) + newText + source.slice(first + oldText.length), changed: true, missing: false };
}

function patchSource(source) {
  let next = source;
  const missing = [];
  let changed = 0;

  for (const edit of edits) {
    if (next.includes(edit.newText)) continue;

    const result = replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) {
      missing.push(edit.oldText.slice(0, 80));
      continue;
    }
    changed += 1;
    next = result.source;
  }

  if (changed > 0 && missing.length > 0) return { source: next, status: "partial", missing };
  if (changed > 0) return { source: next, status: "patched", missing };
  if (missing.length > 0) return { source, status: "skipped", missing };
  return { source, status: "already-patched", missing };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-claude-bridge unrecorded prompt patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched") {
    fs.writeFileSync(file, result.source);
    log("[ai-harnesses] patched pi-claude-bridge to forward unrecorded system prompts");
  } else if (result.status === "skipped") {
    log("[ai-harnesses] pi-claude-bridge unrecorded prompt patch skipped; upstream file shape changed");
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET, PATCH_MARKER };
