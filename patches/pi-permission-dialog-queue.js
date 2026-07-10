const QUEUED = Symbol.for("ai-harnesses.permission-dialog-queue");

function installPermissionDialogQueue(ui) {
  if (ui.select[QUEUED]) return;

  const select = ui.select.bind(ui);
  let tail = Promise.resolve();
  const queuedSelect = (...args) => {
    const result = tail.then(() => select(...args));
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  queuedSelect[QUEUED] = true;
  ui.select = queuedSelect;
}

function permissionDialogQueue(pi) {
  pi.on("session_start", (_event, ctx) => installPermissionDialogQueue(ctx.ui));
}

module.exports = permissionDialogQueue;
module.exports.installPermissionDialogQueue = installPermissionDialogQueue;
