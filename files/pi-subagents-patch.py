#!/usr/bin/env python3
import pathlib
import re
import sys

PATCH_NAME = "pi-subagents safety patch"


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


def ensure_after(path, anchor, addition, marker, description):
    text = read_text(path)
    if marker in text:
        return
    if anchor not in text:
        die(f"could not find insertion point for {description} in {path}")
    write_if_changed(path, text, text.replace(anchor, anchor + addition, 1))


def ensure_before(path, anchor, addition, marker, description):
    text = read_text(path)
    if marker in text:
        return
    if anchor not in text:
        die(f"could not find insertion point for {description} in {path}")
    write_if_changed(path, text, text.replace(anchor, addition + anchor, 1))


def ensure_named_import(path, module, name):
    text = read_text(path)
    import_pattern = re.compile(r'import\s*\{(?P<names>[\s\S]*?)\}\s*from\s*"(?P<module>[^"]+)";')

    for match in import_pattern.finditer(text):
        if match.group("module") != module:
            continue

        names = match.group("names")
        if re.search(rf"\b{re.escape(name)}\b", names):
            return

        if "\n" in names:
            new_names = names if names.endswith("\n") else names + "\n"
            new_names += f"\t{name},\n"
        else:
            stripped_names = names.strip()
            new_names = f" {stripped_names}, {name} " if stripped_names else f" {name} "

        new_text = text[: match.start("names")] + new_names + text[match.end("names") :]
        write_if_changed(path, text, new_text)
        return

    die(f"could not find import from {module} in {path}")


def patch_child_environment(root):
    ensure_after(
        root / "src/runs/shared/pi-args.ts",
        '\tenv[SUBAGENT_CHILD_ENV] = "1";\n',
        '\tenv.PI_IS_SUBAGENT = "1";\n',
        "env.PI_IS_SUBAGENT",
        "PI_IS_SUBAGENT child env marker",
    )
    ensure_after(
        root / "src/extension/index.ts",
        "\t\tstate.currentSessionId = resolveCurrentSessionId(ctx.sessionManager);\n",
        '\t\tprocess.env.PI_AGENT_ROUTER_PARENT_SESSION_ID = ctx.sessionManager.getSessionId() ?? "";\n',
        "PI_AGENT_ROUTER_PARENT_SESSION_ID",
        "parent session id export",
    )


def patch_output_instructions(root):
    # Parent runners own output files; child write/edit prompts can deadlock headless runs.
    replace_once(
        root / "src/runs/shared/single-output.ts",
        "**Output:** Write your findings to: ${outputPath}",
        "**Output:** Return your findings in your final response. Do not call write/edit for this output file; the parent subagent runner will save your final response to: ${outputPath}",
        "single-output parent-owned output instruction",
    )
    replace_once(
        root / "src/shared/settings.ts",
        "\t// OUTPUT - prepend so agent knows where to write",
        "\t// OUTPUT - parent runner saves final response to this path",
        "chain output comment",
    )
    replace_once(
        root / "src/shared/settings.ts",
        "\t\tprefixParts.push(`[Write to: ${outputPath}]`);",
        "\t\tprefixParts.push(`[Output will be saved by parent runner to: ${outputPath}]`);",
        "chain output instruction",
    )


def patch_transient_provider_errors(root):
    # Pi may recover from a transient provider error and produce a later clean final answer.
    utils_path = root / "src/shared/utils.ts"
    clean_stop_function = """export function hasCleanTerminalAssistantStop(messages: Message[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const terminal = (msg as { stopReason?: string }).stopReason === "stop";
		const errored = Boolean((msg as { errorMessage?: string }).errorMessage);
		const hasText = Array.isArray(msg.content) && msg.content.some(
			(part) => part.type === "text" && "text" in part && typeof part.text === "string" && part.text.trim().length > 0,
		);
		return terminal && !errored && hasText;
	}
	return false;
}
"""
    ensure_before(
        utils_path,
        "export function detectSubagentError(messages: Message[]): ErrorInfo {",
        clean_stop_function + "\n",
        "export function hasCleanTerminalAssistantStop",
        "clean terminal assistant stop helper",
    )

    foreground_path = root / "src/runs/foreground/execution.ts"
    ensure_named_import(foreground_path, "../../shared/utils.ts", "hasCleanTerminalAssistantStop")
    ensure_before(
        foreground_path,
        "\tif (result.error && result.exitCode === 0) {\n",
        "\tif (result.error && result.exitCode === 0 && hasCleanTerminalAssistantStop(result.messages)) {\n\t\tresult.error = undefined;\n\t}\n",
        "result.error && result.exitCode === 0 && hasCleanTerminalAssistantStop(result.messages)",
        "foreground transient provider error reset",
    )

    background_path = root / "src/runs/background/subagent-runner.ts"
    ensure_named_import(background_path, "../../shared/utils.ts", "hasCleanTerminalAssistantStop")
    ensure_before(
        background_path,
        "\t\tconst hiddenError = run.exitCode === 0 && !run.error ? detectSubagentError(run.messages) : null;\n",
        "\t\tif (run.error && run.exitCode === 0 && hasCleanTerminalAssistantStop(run.messages)) {\n\t\t\trun.error = undefined;\n\t\t}\n",
        "run.error && run.exitCode === 0 && hasCleanTerminalAssistantStop(run.messages)",
        "background transient provider error reset",
    )


def main(argv):
    if len(argv) != 2:
        die("usage: pi-subagents-patch.py <pi-subagents-root>")

    root = pathlib.Path(argv[1])
    if not root.is_dir():
        die(f"not a directory: {root}")

    patch_child_environment(root)
    patch_output_instructions(root)
    patch_transient_provider_errors(root)


if __name__ == "__main__":
    main(sys.argv)
