const assert = require("node:assert/strict");
const test = require("node:test");

const {
  patchSource,
  promptCaptureEdits,
} = require("../patches/patch-pi-claude-bridge-unrecorded-prompt.js");

/** The two regions the patch edits. The throw's message wording is deliberately not
 *  the anchor: upstream 0.8.0 reworded it, which silently dropped the edit and
 *  restored the throw. */
const source = (message) => `export type PromptCapture = PromptCaptureInput & {
	assembledPrompt: string;
	inherited: InheritedPrompt[];
};

	resolveOrDerive(systemPrompt: string) {
		const embedded = this.findInheritedPrompts(systemPrompt, systemPrompt);
		if (embedded.length === 0) {
			const matches = this.closestKnown(systemPrompt);
			this.onDiagnose({ systemPrompt, matches });
			throw new Error(
				\`${message}\`,
			);
		}
	}
`;

test("an unrecorded prompt is forwarded instead of throwing", () => {
  const result = patchSource(source("prompt-capture: no capture"), promptCaptureEdits);
  assert.equal(result.status, "patched");
  assert.doesNotMatch(result.source, /throw new Error/);
  assert.match(result.source, /unrecorded: true/);
});

test("the miss is still reported to the diagnostic sink", () => {
  const result = patchSource(source("prompt-capture: no capture"), promptCaptureEdits);
  assert.match(result.source, /this\.onDiagnose\(\{ systemPrompt, matches \}\)/);
});

test("rewording the throw message does not drop the edit", () => {
  const reworded = source("totally different wording, added in some later release");
  const result = patchSource(reworded, promptCaptureEdits);
  assert.equal(result.status, "patched");
  assert.match(result.source, /unrecorded: true/);
});

test("patchSource is idempotent", () => {
  const first = patchSource(source("prompt-capture: no capture"), promptCaptureEdits);
  const second = patchSource(first.source, promptCaptureEdits);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

test("a changed throw statement is reported, not silently skipped", () => {
  const drifted = source("x").replace("throw new Error(", "throw new BridgeError(");
  const result = patchSource(drifted, promptCaptureEdits);
  assert.notEqual(result.status, "patched");
  assert.ok(result.missing.length > 0);
});
