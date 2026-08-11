const QUEUED = Symbol.for("ai-harnesses.permission-dialog-queue");
const PERMISSION_PROMPT = "permissions:ui_prompt";

function installPermissionDialogQueue(events, ui) {
  if (ui.custom[QUEUED]) return;

  const select = ui.select.bind(ui);
  const custom = ui.custom.bind(ui);
  let nextCustomIsPermission = false;
  let tail = Promise.resolve();
  const enqueue = (call) => {
    const result = tail.then(call);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  events.on(PERMISSION_PROMPT, () => {
    nextCustomIsPermission = true;
  });

  const queuedSelect = (...args) => enqueue(() => select(...args));
  const queuedCustom = (...args) => {
    if (!nextCustomIsPermission) return custom(...args);
    nextCustomIsPermission = false;
    return enqueue(() => custom(...args));
  };
  queuedCustom[QUEUED] = true;
  ui.select = queuedSelect;
  ui.custom = queuedCustom;
}

function permissionDialogQueue(pi) {
  pi.on("session_start", (_event, ctx) =>
    installPermissionDialogQueue(pi.events, ctx.ui),
  );
}

module.exports = permissionDialogQueue;
module.exports.installPermissionDialogQueue = installPermissionDialogQueue;
