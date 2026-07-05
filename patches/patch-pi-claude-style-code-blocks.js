const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/pi-claude-style-tools/extensions/index.ts",
);

const PATCH_MARKER = "ai-harnesses: simplify pi-claude-style-tools copy chrome";

const edits = [
  {
    oldText: `\t\t\tconst hideBox = PLAIN_FENCE_LANGS.has(language.trim().toLowerCase());\n`,
    newText: `\t\t\t// ${PATCH_MARKER}\n\t\t\tconst hideBox = true;\n`,
    acceptedTexts: [
      `\t\t\t// ai-harnesses: disable pi-claude-style-tools code block boxes\n\t\t\tconst hideBox = true;\n`,
    ],
  },
  {
    oldText: `\t\t// " ● " = 1 margin + dot + space = 3 visible chars\n\t\tconst PREFIX_W = 3;\n\t\tif (safeWidth <= PREFIX_W) {\n\t\t\tthis.cachedWidth = width;\n\t\t\tthis.cachedLines = [clampLineWidth(" ● ", safeWidth)];\n\t\t\treturn this.cachedLines;\n\t\t}\n\t\tconst contentWidth = safeWidth - PREFIX_W;\n`,
    newText: `\t\t// ${PATCH_MARKER}: render assistant markdown flush-left for clean copy/paste.\n\t\tconst contentWidth = safeWidth;\n`,
  },
  {
    oldText: `\t\tlet dotPlaced = false;\n\t\tconst rendered = displayLines.map((line: string) => {\n\t\t\tif (!stripAnsi(line).trim()) return \`   \${line}\`;\n\t\t\tif (isCodeBoxChromeLine(line)) return \`   \${line}\`;\n\t\t\tif (!dotPlaced) {\n\t\t\t\tdotPlaced = true;\n\t\t\t\treturn \` ● \${line}\`;\n\t\t\t}\n\t\t\treturn \`   \${line}\`;\n\t\t}).map((line) => {\n`,
    newText: `\t\tconst rendered = displayLines.map((line: string) => line).map((line) => {\n`,
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
  let next = source;
  const missing = [];
  let changed = 0;
  let satisfied = 0;

  for (const edit of edits) {
    if (next.includes(edit.newText) || edit.acceptedTexts?.some((text) => next.includes(text))) {
      satisfied += 1;
      continue;
    }

    const result = replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) {
      missing.push(edit.oldText.slice(0, 80));
      continue;
    }
    if (result.changed) changed += 1;
    satisfied += 1;
    next = result.source;
  }

  if (changed > 0 && missing.length > 0) return { source: next, status: "partial", missing, satisfied };
  if (changed > 0) return { source: next, status: "patched", missing, satisfied };
  if (missing.length > 0) return { source, status: "skipped", missing, satisfied };
  return { source, status: "already-patched", missing, satisfied };
}

function patchFile(file = DEFAULT_TARGET, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-claude-style-tools code block box patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source);
  if (result.status === "patched" || result.status === "partial") {
    fs.writeFileSync(file, result.source);
    const suffix = result.status === "partial" ? " (partial; some upstream anchors changed)" : "";
    log(`[ai-harnesses] patched pi-claude-style-tools copy chrome${suffix}`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-claude-style-tools copy chrome patch skipped; upstream file shape changed`);
  }
  return result.status;
}

if (require.main === module) {
  patchFile(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { patchSource, patchFile, DEFAULT_TARGET, PATCH_MARKER };
