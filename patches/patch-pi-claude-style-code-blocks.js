const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/pi-claude-style-tools/extensions/index.ts",
);

const PATCH_MARKER = "ai-harnesses: disable pi-claude-style-tools code block boxes";

const edits = [
  {
    oldText: `\t\t\tconst hideBox = PLAIN_FENCE_LANGS.has(language.trim().toLowerCase());\n`,
    newText: `\t\t\t// ${PATCH_MARKER}\n\t\t\tconst hideBox = true;\n`,
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
    log(`[ai-harnesses] pi-claude-style-tools code block box patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched") {
    fs.writeFileSync(file, result.source);
    log(`[ai-harnesses] patched pi-claude-style-tools code block boxes off`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-claude-style-tools code block box patch skipped; upstream file shape changed`);
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET, PATCH_MARKER };
