#!/usr/bin/env python3
import pathlib
import sys

PATCH_NAME = "pi-permission-system subagent forwarding patch"


def die(message):
    raise SystemExit(f"{PATCH_NAME}: {message}")


def read_text(path):
    try:
        return path.read_text()
    except FileNotFoundError:
        die(f"missing expected upstream file: {path}")


def write_if_changed(path, old_text, new_text):
    if new_text != old_text:
        path.write_text(new_text)


def replace_once(path, old, new, description):
    text = read_text(path)
    if new in text:
        return
    if old not in text:
        die(f"could not find {description} in {path}")
    write_if_changed(path, text, text.replace(old, new, 1))


def replace_if_present(path, old, new):
    text = read_text(path)
    if old in text:
        write_if_changed(path, text, text.replace(old, new, 1))


def patch_subagent_env_hints(root):
    replace_once(
        root / "src/permission-forwarding.ts",
        'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;',
        'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;',
        "subagent env hint keys",
    )


def patch_forwarded_response_wait(root):
    path = root / "src/index.ts"
    replace_if_present(
        path,
        '  const deadline = Date.now() + PERMISSION_FORWARDING_TIMEOUT_MS;\n  while (Date.now() < deadline) {\n',
        '  for (;;) {\n',
    )
    replace_if_present(
        path,
        '  for (;;) {\n    const deadline = Number.MAX_SAFE_INTEGER;\n',
        '  for (;;) {\n',
    )
    if "const deadline = Date.now() + PERMISSION_FORWARDING_TIMEOUT_MS" in read_text(path):
        die(f"could not remove forwarded permission response timeout loop in {path}")
    replace_if_present(
        path,
        '    await waitForForwardedPermissionResponseFile(responsePath, deadline);\n',
        '    await waitForForwardedPermissionResponseFile(responsePath, Number.MAX_SAFE_INTEGER);\n',
    )
    if "waitForForwardedPermissionResponseFile(responsePath, deadline)" in read_text(path):
        die(f"could not remove forwarded permission response deadline in {path}")
    replace_if_present(
        path,
        '''
  logPermissionForwardingWarning(`Timed out waiting for forwarded permission response '${responsePath}'`);
  writeReviewEntry("forwarded_permission.response_timed_out", {
    requestId,
    requesterAgentName,
    targetSessionId,
    responsePath,
  });
  safeDeleteFile(requestPath, "forwarded permission request");
  cleanupPermissionForwardingLocationIfEmpty(location);
  return { approved: false, state: "denied" };
''',
        "\n",
    )
    replace_if_present(
        path,
        '''
  logPermissionForwardingWarning(`Timed out waiting for forwarded permission response '${responsePath}'`);
  writeReviewLog("forwarded_permission.response_timed_out", {
    requestId,
    requesterAgentName,
    targetSessionId,
    responsePath,
  });
  safeDeleteFile(requestPath, "forwarded permission request");
  cleanupPermissionForwardingLocationIfEmpty(location);
  return { approved: false, state: "denied" };
''',
        "\n",
    )
    replace_if_present(
        path,
        "\n  // pi-dotfiles: forwarded subagent permissions intentionally wait for the human instead of timing out.\n",
        "\n",
    )
    replace_if_present(path, "  PERMISSION_FORWARDING_TIMEOUT_MS,\n", "")
    if "forwarded_permission.response_timed_out" in read_text(path):
        die(f"could not remove forwarded permission response timeout in {path}")


def patch_forwarded_prompt_handling(root):
    path = root / "src/index.ts"
    replace_once(
        path,
        '  const requesterAgentName = getActiveAgentName(ctx) || getActiveAgentNameFromSystemPrompt(getContextSystemPrompt(ctx)) || "unknown";\n',
        '  const requesterAgentName = normalizeAgentName(process.env.PI_SUBAGENT_CHILD_AGENT) || getActiveAgentName(ctx) || getActiveAgentNameFromSystemPrompt(getContextSystemPrompt(ctx)) || "unknown";\n',
        "forwarded permission requester agent env fallback",
    )
    replace_once(
        path,
        '''    const requestAgeMs = Date.now() - request.createdAt;
    let decision: PermissionPromptDecision = { approved: false, state: "denied" };
    if (requestAgeMs >= PERMISSION_FORWARDING_TIMEOUT_MS) {
      writeReviewEntry("forwarded_permission.expired", {
        ...forwardedPermissionLogDetails,
        requestAgeMs,
        timeoutMs: PERMISSION_FORWARDING_TIMEOUT_MS,
      });
      decision = {
        approved: false,
        state: "denied",
        denialReason: "permission_timeout: forwarded permission request expired before it could be displayed.",
      };
    } else if (shouldAutoApprovePermissionState("ask", extensionConfig)) {
''',
        '''    let decision: PermissionPromptDecision = { approved: false, state: "denied" };
    if (shouldAutoApprovePermissionState("ask", extensionConfig)) {
''',
        "forwarded permission request expiry removal",
    )
    replace_if_present(
        path,
        '''      try {
        ctx.ui.notify(
          `Subagent '${request.requesterAgentName || "unknown"}' is waiting for permission approval.`,
          "warning",
        );
      } catch (error) {
        logPermissionForwardingWarning("Failed to show forwarded permission notification", error);
      }
      try {
''',
        "      try {\n",
    )
    replace_if_present(
        path,
        "      // pi-dotfiles: the permission dialog below is enough; suppress duplicate waiting toast.\n",
        "",
    )
    if "waiting for permission approval" in read_text(path):
        die(f"could not remove redundant forwarded permission waiting notification in {path}")
    replace_once(
        path,
        '''        decision = await requestPermissionDecisionFromUi(
          ctx.ui,
          "Permission Required (Subagent)",
          [
            formatForwardedPermissionPrompt(request),
            "",
            `This forwarded prompt auto-denies after ${Math.round(FORWARDED_PERMISSION_PROMPT_TIMEOUT_MS / 1000)} seconds if unanswered.`,
          ].join("\\n"),
          {
            timeoutMs: FORWARDED_PERMISSION_PROMPT_TIMEOUT_MS,
            timeoutDenialReason: FORWARDED_PERMISSION_PROMPT_TIMEOUT_REASON,
          },
        );
''',
        '''        decision = await requestPermissionDecisionFromUi(
          ctx.ui,
          "Permission Required (Subagent)",
          formatForwardedPermissionPrompt(request),
        );
''',
        "forwarded permission prompt timeout removal",
    )
    replace_if_present(
        path,
        'const FORWARDED_PERMISSION_PROMPT_TIMEOUT_MS = 30 * 1000;\nconst FORWARDED_PERMISSION_PROMPT_TIMEOUT_REASON = "permission_timeout: forwarded permission prompt was not answered within 30 seconds.";\n',
        "",
    )


def main(argv):
    if len(argv) != 2:
        die("usage: pi-permission-system-patch.py <pi-permission-system-root>")

    root = pathlib.Path(argv[1])
    if not root.is_dir():
        die(f"not a directory: {root}")

    patch_subagent_env_hints(root)
    patch_forwarded_response_wait(root)
    patch_forwarded_prompt_handling(root)


if __name__ == "__main__":
    main(sys.argv)
