const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { installPermissionDialogQueue } = require("../patches/pi-permission-dialog-queue.js");

for (const labels of [
  ["main", "subagent"],
  ["subagent", "main"],
]) {
  test(`serializes ${labels.join(" then ")} permission dialogs`, async () => {
    const events = new EventEmitter();
    const calls = [];
    let releaseFirst;
    const ui = {
      select: async (label) => label,
      custom(label) {
        calls.push(label);
        if (label === labels[0]) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(label);
      },
    };

    installPermissionDialogQueue(events, ui);
    installPermissionDialogQueue(events, ui);

    events.emit("permissions:ui_prompt");
    const first = ui.custom(labels[0]);
    events.emit("permissions:ui_prompt");
    const second = ui.custom(labels[1]);
    await Promise.resolve();
    assert.deepEqual(calls, [labels[0]]);

    releaseFirst(labels[0]);
    assert.deepEqual(await Promise.all([first, second]), labels);
  });
}

test("keeps select dialogs serialized", async () => {
  const events = new EventEmitter();
  const calls = [];
  let releaseFirst;
  const ui = {
    select(label) {
      calls.push(label);
      return label === "first"
        ? new Promise((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve(label);
    },
    custom: async (label) => label,
  };
  installPermissionDialogQueue(events, ui);

  const first = ui.select("first");
  const second = ui.select("second");
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);

  releaseFirst("first");
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
});

test("leaves other custom dialogs alone and continues after rejection", async () => {
  const events = new EventEmitter();
  const calls = [];
  const ui = {
    select: async (label) => label,
    custom(label) {
      calls.push(label);
      return label === "reject"
        ? Promise.reject(new Error("failed"))
        : Promise.resolve(label);
    },
  };
  installPermissionDialogQueue(events, ui);

  assert.equal(await ui.custom("ordinary"), "ordinary");

  events.emit("permissions:ui_prompt");
  await assert.rejects(ui.custom("reject"), /failed/);
  events.emit("permissions:ui_prompt");
  assert.equal(await ui.custom("recovered"), "recovered");
  assert.deepEqual(calls, ["ordinary", "reject", "recovered"]);
});
