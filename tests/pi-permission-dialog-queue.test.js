const assert = require("node:assert/strict");
const test = require("node:test");
const { installPermissionDialogQueue } = require("../patches/pi-permission-dialog-queue.js");

test("serializes dialogs and continues after rejection", async () => {
  const calls = [];
  let releaseFirst;
  const ui = {
    select(label) {
      calls.push(label);
      if (label === "first") {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      if (label === "reject") return Promise.reject(new Error("failed"));
      return Promise.resolve(label);
    },
  };

  installPermissionDialogQueue(ui);
  installPermissionDialogQueue(ui);

  const first = ui.select("first");
  const second = ui.select("second");
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);

  releaseFirst("first");
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);

  await assert.rejects(ui.select("reject"), /failed/);
  assert.equal(await ui.select("recovered"), "recovered");
  assert.deepEqual(calls, ["first", "second", "reject", "recovered"]);
});
