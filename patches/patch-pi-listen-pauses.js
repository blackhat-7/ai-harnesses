const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ROOT = path.join(
  os.homedir(),
  ".pi/agent/npm/node_modules/@codexstar/pi-listen/extensions",
);
const VOICE_MARKER = "ai-harnesses: use full-turn auto-speak";
const SPEAK_MARKER = "ai-harnesses: natural sentence pauses";

function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first === -1) return null;
  if (source.indexOf(oldText, first + oldText.length) !== -1) {
    throw new Error(`patch anchor is not unique: ${oldText.slice(0, 80)}`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function applyEdits(source, marker, edits) {
  if (source.includes(marker)) return { source, status: "already-patched" };

  let next = source;
  for (const [oldText, newText] of edits) {
    next = replaceOnce(next, oldText, newText);
    if (next === null) return { source, status: "skipped" };
  }
  return { source: next, status: "patched" };
}

function patchVoiceSource(source) {
  return applyEdits(source, VOICE_MARKER, [
    [
      "\tconst messageStreams = new Map<string, MessageStreamState>();\n",
      `\tconst messageStreams = new Map<string, MessageStreamState>();\n\t// ${VOICE_MARKER}; local models synthesize the complete response through\n\t// speak(), which pipelines chunks without multi-second per-sentence startup gaps.\n\tconst STREAMING_AUTO_SPEAK = false;\n`,
    ],
    [
      `\tpi.on("message_update", async (event) => {\n\t\tconst msg = (event as any)?.message;\n`,
      `\tpi.on("message_update", async (event) => {\n\t\tif (!STREAMING_AUTO_SPEAK) return;\n\t\tconst msg = (event as any)?.message;\n`,
    ],
    [
      `\tpi.on("message_end", async (event) => {\n\t\tconst msg = (event as any)?.message;\n`,
      `\tpi.on("message_end", async (event) => {\n\t\tif (!STREAMING_AUTO_SPEAK) return;\n\t\tconst msg = (event as any)?.message;\n`,
    ],
  ]);
}

function patchSpeakSource(source) {
  return applyEdits(source, SPEAK_MARKER, [
    [
      "const MAX_CHUNK_CHARS = 600;\n",
      `const MAX_CHUNK_CHARS = 600;\n// ${SPEAK_MARKER}; added after each sentence, beyond model-provided silence.\nconst SENTENCE_PAUSE_MS = 1000;\n`,
    ],
    [
      `export function chunkText(text: string, language: string): string[] {\n\tconst trimmed = text.trim();\n\tif (!trimmed) return [];\n\n\tconst sentences = segmentSentences(trimmed, language);\n\tconst chunks: string[] = [];\n\tlet buf = "";\n\n\tfor (const sentence of sentences) {\n\t\tconst s = sentence.trim();\n\t\tif (!s) continue;\n\n\t\tif (s.length > MAX_CHUNK_CHARS) {\n\t\t\t// Single sentence longer than cap — wrap-split on word boundaries.\n\t\t\tif (buf) { chunks.push(buf); buf = ""; }\n\t\t\tchunks.push(...wordWindowSplit(s));\n\t\t\tcontinue;\n\t\t}\n\n\t\tconst candidate = buf ? \`\${buf} \${s}\` : s;\n\t\tif (candidate.length > MAX_CHUNK_CHARS) {\n\t\t\tchunks.push(buf);\n\t\t\tbuf = s;\n\t\t} else {\n\t\t\tbuf = candidate;\n\t\t}\n\t}\n\tif (buf) chunks.push(buf);\n\treturn chunks;\n}\n`,
      `export function chunkText(text: string, language: string): string[] {\n\tconst trimmed = text.trim();\n\tif (!trimmed) return [];\n\n\tconst chunks: string[] = [];\n\tfor (const sentence of segmentSentences(trimmed, language)) {\n\t\tconst value = sentence.trim();\n\t\tif (!value) continue;\n\t\tif (value.length > MAX_CHUNK_CHARS) chunks.push(...wordWindowSplit(value));\n\t\telse chunks.push(value);\n\t}\n\treturn chunks;\n}\n`,
    ],
    [
      `\t\t\t\t\tif (i + 1 < chunks.length) nextSynth = synthOne(chunks[i + 1]!);\n\t\t\t\t\tawait stream.writePcm(float32ToInt16(audio.samples));\n\t\t\t\t\tcontinue;\n`,
      `\t\t\t\t\tif (i + 1 < chunks.length) nextSynth = synthOne(chunks[i + 1]!);\n\t\t\t\t\tawait stream.writePcm(float32ToInt16(audio.samples));\n\t\t\t\t\tif (i + 1 < chunks.length) {\n\t\t\t\t\t\tawait stream.writePcm(new Int16Array(Math.round(audio.sampleRate * SENTENCE_PAUSE_MS / 1000)));\n\t\t\t\t\t}\n\t\t\t\t\tcontinue;\n`,
    ],
    [
      `\t\t\tawait playAudio({ source: audio, signal });\n\t\t\tif (signal?.aborted) throw makeAbortError();\n`,
      `\t\t\tawait playAudio({ source: audio, signal });\n\t\t\tif (signal?.aborted) throw makeAbortError();\n\t\t\tif (i + 1 < chunks.length) {\n\t\t\t\tawait new Promise(resolve => setTimeout(resolve, SENTENCE_PAUSE_MS));\n\t\t\t}\n`,
    ],
  ]);
}

function patchPackage(root = DEFAULT_ROOT, log = console.warn) {
  const voiceFile = path.join(root, "voice.ts");
  const speakFile = path.join(root, "voice/speak.ts");
  if (!fs.existsSync(voiceFile) || !fs.existsSync(speakFile)) {
    log(`[ai-harnesses] pi-listen pause patch skipped; package files are missing`);
    return "missing";
  }

  const voice = patchVoiceSource(fs.readFileSync(voiceFile, "utf8"));
  const speak = patchSpeakSource(fs.readFileSync(speakFile, "utf8"));
  if (voice.status === "skipped" || speak.status === "skipped") {
    log(`[ai-harnesses] pi-listen pause patch skipped; upstream file shape changed`);
    return "skipped";
  }
  if (voice.status === "already-patched" && speak.status === "already-patched") {
    return "already-patched";
  }

  fs.writeFileSync(voiceFile, voice.source);
  fs.writeFileSync(speakFile, speak.source);
  log(`[ai-harnesses] patched pi-listen full-turn speech and natural sentence pauses`);
  return "patched";
}

if (require.main === module) patchPackage(process.argv[2] || DEFAULT_ROOT);

module.exports = {
  patchVoiceSource,
  patchSpeakSource,
  patchPackage,
  DEFAULT_ROOT,
};
