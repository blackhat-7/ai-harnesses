const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  patchPackage,
  patchSpeakSource,
  patchVoiceSource,
} = require("../patches/patch-pi-listen-pauses.js");

const voiceSource = `	const messageStreams = new Map<string, MessageStreamState>();

	pi.on("message_update", async (event) => {
		const msg = (event as any)?.message;
	});

	pi.on("message_end", async (event) => {
		const msg = (event as any)?.message;
	});
`;

const speakSource = `					if (i + 1 < chunks.length) nextSynth = synthOne(chunks[i + 1]!);
					await stream.writePcm(float32ToInt16(audio.samples));
					continue;

			await playAudio({ source: audio, signal });
			if (signal?.aborted) throw makeAbortError();

const MAX_CHUNK_CHARS = 600;

export function chunkText(text: string, language: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const sentences = segmentSentences(trimmed, language);
	const chunks: string[] = [];
	let buf = "";

	for (const sentence of sentences) {
		const s = sentence.trim();
		if (!s) continue;

		if (s.length > MAX_CHUNK_CHARS) {
			// Single sentence longer than cap — wrap-split on word boundaries.
			if (buf) { chunks.push(buf); buf = ""; }
			chunks.push(...wordWindowSplit(s));
			continue;
		}

		const candidate = buf ? \`\${buf} \${s}\` : s;
		if (candidate.length > MAX_CHUNK_CHARS) {
			chunks.push(buf);
			buf = s;
		} else {
			buf = candidate;
		}
	}
	if (buf) chunks.push(buf);
	return chunks;
}
`;

test("disables fragmented streaming auto-speak", () => {
  const result = patchVoiceSource(voiceSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, /const STREAMING_AUTO_SPEAK = false/);
  assert.equal((result.source.match(/if \(!STREAMING_AUTO_SPEAK\) return;/g) || []).length, 2);
});

test("splits synthesis by sentence and inserts a short deterministic pause", () => {
  const result = patchSpeakSource(speakSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, /const SENTENCE_PAUSE_MS = 240/);
  assert.match(result.source, /for \(const sentence of segmentSentences/);
  assert.doesNotMatch(result.source, /let buf = ""/);
  assert.match(result.source, /new Int16Array\(Math\.round\(audio\.sampleRate \* SENTENCE_PAUSE_MS \/ 1000\)\)/);
  assert.match(result.source, /setTimeout\(resolve, SENTENCE_PAUSE_MS\)/);
});

test("patches the package atomically and is idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-listen-pause-patch-"));
  fs.mkdirSync(path.join(root, "voice"));
  fs.writeFileSync(path.join(root, "voice.ts"), voiceSource);
  fs.writeFileSync(path.join(root, "voice/speak.ts"), speakSource);

  assert.equal(patchPackage(root, () => {}), "patched");
  assert.equal(patchPackage(root, () => {}), "already-patched");
  assert.match(fs.readFileSync(path.join(root, "voice.ts"), "utf8"), /full-turn auto-speak/);
  assert.match(fs.readFileSync(path.join(root, "voice/speak.ts"), "utf8"), /natural sentence pauses/);
});
