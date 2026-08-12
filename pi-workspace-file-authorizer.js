const fs = require("node:fs");
const path = require("node:path");

const AUTHOR_NAME = "workspace-file-edits";
const FILE_EDIT_TOOLS = new Set(["edit", "write", "ctx_edit", "ctx_patch"]);
const PATH_PREVIEW_PREFIX = "at path ";

function canonicalize(target, cwd) {
  let current = path.resolve(cwd, target.replace(/^@/, ""));
  const missing = [];

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    missing.unshift(path.basename(current));
    current = parent;
  }

  return path.join(fs.realpathSync.native(current), ...missing);
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function targetsGit(target, cwd) {
  if (target.split(/[\\/]+/).includes(".git")) return true;
  try {
    return canonicalize(target, cwd).split(path.sep).includes(".git");
  } catch {
    return false;
  }
}

function previewPath(details) {
  if (!details.toolInputPreview?.startsWith(PATH_PREVIEW_PREFIX)) return undefined;
  try {
    const value = JSON.parse(details.toolInputPreview.slice(PATH_PREVIEW_PREFIX.length));
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function classifyFileEdit(details, cwd) {
  const toolName = details.toolName ?? details.surface;
  if (!FILE_EDIT_TOOLS.has(toolName)) return { kind: "defer" };

  const rawPath = previewPath(details);
  const candidates = [rawPath, ...(details.accessIntent?.matchValues ?? [])].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (candidates.length === 0) return { kind: "defer" };
  if (candidates.some((value) => targetsGit(value, cwd))) {
    return { kind: "deny", reason: "Editing .git is not allowed" };
  }
  if (candidates.some((value) => path.basename(value) === ".env")) {
    return { kind: "defer" };
  }

  try {
    const target = canonicalize(details.accessIntent?.boundaryValue ?? rawPath, cwd);
    if (path.basename(target) === ".env") return { kind: "defer" };

    const workspace = canonicalize(cwd, "/");
    const tmp = canonicalize("/tmp", "/");
    return isWithin(workspace, target) || isWithin(tmp, target)
      ? { kind: "allow" }
      : { kind: "defer" };
  } catch {
    return { kind: "defer" };
  }
}

function pathPreview(input) {
  return typeof input.path === "string"
    ? `${PATH_PREVIEW_PREFIX}${JSON.stringify(input.path)}`
    : undefined;
}

function workspaceFileAuthorizer(pi) {
  let cwd;
  let dispose = [];

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });

  pi.on("tool_call", (event, ctx) => {
    const target = event.input?.path;
    if (
      FILE_EDIT_TOOLS.has(event.toolName) &&
      typeof target === "string" &&
      targetsGit(target, ctx.cwd)
    ) {
      return { block: true, reason: "Editing .git is not allowed" };
    }
  });

  pi.events.on("permissions:ready", () => {
    void (async () => {
      try {
        const { getPermissionsService } = await import("@gotgenes/pi-permission-system");
        const permissions = getPermissionsService();
        if (!permissions) return;

        dispose.forEach((fn) => fn());
        dispose = [
          permissions.registerToolInputFormatter("ctx_edit", pathPreview),
          permissions.registerToolInputFormatter("ctx_patch", pathPreview),
          permissions.registerAuthorizer(AUTHOR_NAME, async (details, _query, log) => {
            const verdict = cwd ? classifyFileEdit(details, cwd) : { kind: "defer" };
            if (verdict.kind !== "defer") {
              log.review(`workspace_file_authorizer.${verdict.kind}`, {
                requestId: details.requestId,
                toolName: details.toolName ?? details.surface ?? null,
              });
            }
            return verdict;
          }),
        ];
      } catch {
        // pi-permission-system is optional.
      }
    })();
  });

  pi.on("session_shutdown", () => {
    dispose.forEach((fn) => fn());
    dispose = [];
    cwd = undefined;
  });
}

module.exports = workspaceFileAuthorizer;
module.exports.classifyFileEdit = classifyFileEdit;
module.exports.pathPreview = pathPreview;
module.exports.targetsGit = targetsGit;
