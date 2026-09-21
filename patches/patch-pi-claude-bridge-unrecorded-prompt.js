const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ROOT = path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-claude-bridge/src");

const PATCH_MARKER = "ai-harnesses: forward unrecorded system prompts";

// pi-automode's permission classifier calls the provider's streamSimple with a
// system prompt it builds itself, so `before_agent_start` never records it and
// resolveOrDerive matches neither an exact key nor an embedded one.
//
// Upstream throws there, automode fails closed, and every tool call is blocked.
// Carrying the prompt through as `custom` loses nothing: it is the caller's whole
// instruction set, and an unrecorded prompt has no pi context files or skills
// behind it to drop. Recorded prompts never reach that branch.
//
// Such a prompt is also self-contained, so it replaces Claude Code's preset rather
// than appending to it. The preset frames a one-shot JSON request as a coding task
// — which is how automode ends up parsing prose instead of a decision — and bills
// latency for guidance a classifier cannot use.
const promptCaptureEdits = [
  {
    oldText: [
      "export type PromptCapture = PromptCaptureInput & {",
      "\tassembledPrompt: string;",
      "",
    ].join("\n"),
    newText: [
      "export type PromptCapture = PromptCaptureInput & {",
      "\tassembledPrompt: string;",
      `\t/** ${PATCH_MARKER}: no capture matched; \`custom\` is the caller's own prompt. */`,
      "\tunrecorded?: boolean;",
      "",
    ].join("\n"),
  },
  {
    // Anchored on the `throw` statement alone, not on the message it builds: the
    // wording is the most volatile part of this block and 0.8.0 rewrote it, which
    // silently dropped this edit and put the throw back. `closestKnown` and the
    // `onDiagnose` call above it are left in place, so a miss still reaches the
    // bridge's debug log; only the throw becomes a forward.
    startText: "\t\t\tthrow new Error(\n",
    endText: "\t\t\t);\n",
    newText: [
      `\t\t\t// ${PATCH_MARKER}: pi-automode's classifier builds its own prompt, which`,
      "\t\t\t// before_agent_start never records. Throwing here makes automode fail closed and",
      "\t\t\t// block every tool call. An unrecorded prompt has no pi context files or skills",
      "\t\t\t// behind it, so carrying it through as `custom` drops nothing.",
      "\t\t\treturn { assembledPrompt: systemPrompt, custom: systemPrompt, contextFiles: [], skills: [], inherited: [], unrecorded: true };",
      "",
    ].join("\n"),
  },
];

const indexEdits = [
  {
    oldText: [
      "\t\tsystemPrompt: {",
      "\t\t\ttype: \"preset\", preset: \"claude_code\",",
      "\t\t\tappend: systemPromptAppend ? systemPromptAppend : undefined,",
      "\t\t},",
      "",
    ].join("\n"),
    newText: [
      `\t\t// ${PATCH_MARKER}: a prompt pi never assembled is a self-contained one-shot, so`,
      "\t\t// it becomes the whole system prompt. Claude Code's preset would otherwise frame a",
      "\t\t// JSON-only classifier request as a coding task and bill latency it cannot use.",
      "\t\tsystemPrompt: promptCapture?.unrecorded && systemPromptAppend",
      "\t\t\t? systemPromptAppend",
      "\t\t\t: {",
      "\t\t\t\ttype: \"preset\", preset: \"claude_code\",",
      "\t\t\t\tappend: systemPromptAppend ? systemPromptAppend : undefined,",
      "\t\t\t},",
      "",
    ].join("\n"),
  },
];

const targets = [
  { file: "prompt-capture.ts", edits: promptCaptureEdits },
  { file: "index.ts", edits: indexEdits },
];

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return { source, changed: false, missing: true };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  return { source: source.slice(0, first) + newText + source.slice(first + oldText.length), changed: true, missing: false };
}

/** Replace everything from `startText` through `endText` inclusive. Keyed on the
 *  stable edges of a statement so an upstream reword of its body cannot drop the edit. */
function replaceSpan(source, startText, endText, newText) {
  const start = source.indexOf(startText);
  if (start === -1) return { source, changed: false, missing: true };
  if (source.indexOf(startText, start + startText.length) !== -1) {
    throw new Error(`patch anchor is not unique: ${startText.slice(0, 80)}`);
  }
  const end = source.indexOf(endText, start + startText.length);
  if (end === -1) return { source, changed: false, missing: true };
  return { source: source.slice(0, start) + newText + source.slice(end + endText.length), changed: true, missing: false };
}

function patchSource(source, edits) {
  let next = source;
  const missing = [];
  let changed = 0;

  for (const edit of edits) {
    if (next.includes(edit.newText)) continue;

    const result = edit.startText
      ? replaceSpan(next, edit.startText, edit.endText, edit.newText)
      : replaceOnce(next, edit.oldText, edit.newText);
    if (result.missing) {
      missing.push((edit.oldText ?? edit.startText).slice(0, 80));
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

function patchFile(file, edits, log = console.warn) {
  if (!fs.existsSync(file)) {
    log(`[ai-harnesses] pi-claude-bridge unrecorded prompt patch skipped; missing ${file}`);
    return "missing";
  }

  const source = fs.readFileSync(file, "utf8");
  const result = patchSource(source, edits);
  if (result.status === "patched" || result.status === "partial") {
    fs.writeFileSync(file, result.source);
    const suffix = result.status === "partial" ? " (partial; some upstream anchors changed)" : "";
    log(`[ai-harnesses] patched pi-claude-bridge ${path.basename(file)} for unrecorded system prompts${suffix}`);
  } else if (result.status === "skipped") {
    log(`[ai-harnesses] pi-claude-bridge ${path.basename(file)} patch skipped; upstream file shape changed`);
  }
  return result.status;
}

function patchAll(root = DEFAULT_ROOT, log = console.warn) {
  return targets.map(({ file, edits }) => ({
    file,
    status: patchFile(path.join(root, file), edits, log),
  }));
}

if (require.main === module) {
  const results = patchAll(process.argv[2] || DEFAULT_ROOT);
  // A drifted anchor used to pass silently: 0.8.0 reworded the throw, this patch lost
  // its forwarding route, and automode went back to blocking every tool call with no
  // signal at switch time. Fail activation instead so the next upgrade cannot repeat it.
  // `missing` stays a warning: the file is absent only before the first extension
  // install, which the same activation performs a step earlier.
  const drifted = results.filter((r) => r.status === "partial" || r.status === "skipped");
  if (drifted.length > 0) {
    console.error(
      "[ai-harnesses] pi-claude-bridge unrecorded-prompt patch did not apply: "
      + drifted.map((r) => `${r.file}=${r.status}`).join(", ")
      + `. Upstream source changed; update the anchors in ${path.basename(__filename)}.`,
    );
    process.exit(1);
  }
}

module.exports = { patchSource, patchFile, patchAll, promptCaptureEdits, indexEdits, DEFAULT_ROOT, PATCH_MARKER };
