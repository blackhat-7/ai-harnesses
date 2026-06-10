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


def replace_if_present(path, old, new, description=None):
    text = read_text(path)
    if old in text and new not in text:
        write_if_changed(path, text, text.replace(old, new, 1))


def remove_if_present(path, old):
    text = read_text(path)
    if old in text:
        write_if_changed(path, text, text.replace(old, "", 1))


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


def patch_reviewer_default_reads(root):
    # Reviewer runs in arbitrary repos; callers can opt into reads per task.
    remove_if_present(
        root / "agents/reviewer.md",
        "defaultReads: plan.md, progress.md\n",
    )


def patch_forced_async_keeps_foreground_timeouts(root):
    # If forceTopLevelAsync is enabled, preserve caller timeouts instead of
    # turning the run into an unbounded detached process.
    path = root / "src/runs/background/top-level-async.ts"
    replace_if_present(
        path,
        "\tconst { timeoutMs: _timeoutMs, maxRuntimeMs: _maxRuntimeMs, ...rest } = params;\n\treturn { ...rest, async: true, clarify: false } as T;\n",
        "\treturn { ...params, async: true, clarify: false } as T;\n",
    )


def patch_interrupt_escalation(root):
    background_path = root / "src/runs/background/subagent-runner.ts"
    replace_if_present(
        background_path,
        "\t\t\ttrySignalChild(child, \"SIGINT\");\n\t\t\tresourceLimitEscalationTimer = setTimeout(() => {\n\t\t\t\tif (!settled) trySignalChild(child, \"SIGTERM\");\n\t\t\t}, 1000);\n\t\t\tresourceLimitEscalationTimer.unref?.();\n",
        "\t\t\ttrySignalChild(child, \"SIGINT\");\n\t\t\tresourceLimitEscalationTimer = setTimeout(() => {\n\t\t\t\tif (settled) return;\n\t\t\t\ttrySignalChild(child, \"SIGTERM\");\n\t\t\t\tconst forceKillTimer = setTimeout(() => {\n\t\t\t\t\tif (!settled) trySignalChild(child, \"SIGKILL\");\n\t\t\t\t}, 3000);\n\t\t\t\tforceKillTimer.unref?.();\n\t\t\t}, 1000);\n\t\t\tresourceLimitEscalationTimer.unref?.();\n",
        "background resource limit hard kill escalation",
    )
    replace_if_present(
        background_path,
        "\t\t\ttrySignalChild(child, \"SIGINT\");\n\t\t\tsetTimeout(() => {\n\t\t\t\tif (!settled) trySignalChild(child, \"SIGTERM\");\n\t\t\t}, 1000).unref?.();\n",
        "\t\t\ttrySignalChild(child, \"SIGINT\");\n\t\t\tconst terminateTimer = setTimeout(() => {\n\t\t\t\tif (settled) return;\n\t\t\t\ttrySignalChild(child, \"SIGTERM\");\n\t\t\t\tconst forceKillTimer = setTimeout(() => {\n\t\t\t\t\tif (!settled) trySignalChild(child, \"SIGKILL\");\n\t\t\t\t}, 3000);\n\t\t\t\tforceKillTimer.unref?.();\n\t\t\t}, 1000);\n\t\t\tterminateTimer.unref?.();\n",
        "background interrupt hard kill escalation",
    )

    foreground_path = root / "src/runs/foreground/execution.ts"
    replace_if_present(
        foreground_path,
        "\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\tresourceLimitEscalationTimer = setTimeout(() => {\n\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t}, 1000);\n\t\t\tresourceLimitEscalationTimer.unref?.();\n",
        "\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\tresourceLimitEscalationTimer = setTimeout(() => {\n\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t\tconst forceKillTimer = setTimeout(() => {\n\t\t\t\t\tif (!(settled || processClosed || detached)) trySignalChild(proc, \"SIGKILL\");\n\t\t\t\t}, 3000);\n\t\t\t\tforceKillTimer.unref?.();\n\t\t\t}, 1000);\n\t\t\tresourceLimitEscalationTimer.unref?.();\n",
        "foreground resource limit hard kill escalation",
    )
    replace_if_present(
        foreground_path,
        "\t\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\t\ttimeoutEscalationTimer = setTimeout(() => {\n\t\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t\t}, 1000);\n\t\t\t\ttimeoutEscalationTimer.unref?.();\n",
        "\t\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\t\ttimeoutEscalationTimer = setTimeout(() => {\n\t\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t\t\tconst forceKillTimer = setTimeout(() => {\n\t\t\t\t\t\tif (!(settled || processClosed || detached)) trySignalChild(proc, \"SIGKILL\");\n\t\t\t\t\t}, 3000);\n\t\t\t\t\tforceKillTimer.unref?.();\n\t\t\t\t}, 1000);\n\t\t\t\ttimeoutEscalationTimer.unref?.();\n",
        "foreground timeout hard kill escalation",
    )
    replace_if_present(
        foreground_path,
        "\t\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\t\tsetTimeout(() => {\n\t\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t\t}, 1000).unref?.();\n",
        "\t\t\t\ttrySignalChild(proc, \"SIGINT\");\n\t\t\t\tconst terminateTimer = setTimeout(() => {\n\t\t\t\t\tif (settled || processClosed || detached) return;\n\t\t\t\t\ttrySignalChild(proc, \"SIGTERM\");\n\t\t\t\t\tconst forceKillTimer = setTimeout(() => {\n\t\t\t\t\t\tif (!(settled || processClosed || detached)) trySignalChild(proc, \"SIGKILL\");\n\t\t\t\t\t}, 3000);\n\t\t\t\t\tforceKillTimer.unref?.();\n\t\t\t\t}, 1000);\n\t\t\t\tterminateTimer.unref?.();\n",
        "foreground interrupt hard kill escalation",
    )


def patch_sticky_async_widget(root):
    # Keep the background-agent widget compact and sticky next to the todo widget.
    path = root / "src/tui/render.ts"
    old = '''function buildWidgetComponent(jobs: AsyncJobState[], expanded: boolean): (_tui: unknown, theme: Theme) => Component {
	return (_tui, theme) => {
		const width = getTermWidth();
		const lines = expanded
			? buildWidgetLines(jobs, theme, width, true)
			: jobs.length === 1
				? compactSingleWidgetLines(jobs[0]!, theme, width)
				: buildWidgetLines(jobs, theme, width, false);
		const container = new Container();
		for (const line of fitWidgetLineBudget(lines, theme, width, expanded)) container.addChild(new Text(line, 1, 0));
		return container;
	};
}
'''
    new = '''function widgetJobStatusText(job: AsyncJobState, theme: Theme): string {
	if (job.status === "running") return theme.fg("accent", "running");
	if (job.status === "queued") return theme.fg("dim", "queued");
	if (job.status === "complete") return theme.fg("success", "done");
	if (job.status === "paused") return theme.fg("warning", "paused");
	return theme.fg("error", "failed");
}

function buildCompactStickyWidgetLines(jobs: AsyncJobState[], theme: Theme, width: number): string[] {
	const running = jobs.filter((job) => job.status === "running");
	const queued = jobs.filter((job) => job.status === "queued");
	const activeJobs = [...running, ...queued];
	const visibleJobs = activeJobs.length > 0 ? activeJobs : jobs;
	const headerColor = activeJobs.length > 0 ? "accent" : "dim";
	const spinnerSeed = Math.floor(Date.now() / 250);
	const headerGlyph = running.length > 0 ? runningGlyph(spinnerSeed) : queued.length > 0 ? "●" : "○";
	const summary = statJoin(theme, [
		running.length > 0 ? `${running.length} running` : "",
		queued.length > 0 ? `${queued.length} queued` : "",
	]);
	const lines = [truncLine(`${theme.fg(headerColor, headerGlyph)} ${theme.fg(headerColor, "Async agents")}${summary ? ` ${theme.fg("dim", "·")} ${summary}` : ""}`, width)];

	const shown = visibleJobs.slice(0, Math.max(1, MAX_WIDGET_JOBS));
	const hidden = visibleJobs.length - shown.length;
	for (const [index, job] of shown.entries()) {
		const branch = index === shown.length - 1 && hidden === 0 ? "└─" : "├─";
		const glyph = job.status === "running" ? theme.fg("accent", runningGlyph(spinnerSeed + index)) : widgetStatusGlyph(job, theme);
		const activity = widgetActivity(job);
		const details = [
			widgetJobStatusText(job, theme),
			widgetStats(job, theme),
			activity ? theme.fg("dim", activity) : "",
		].filter(Boolean).join(` ${theme.fg("dim", "·")} `);
		lines.push(truncLine(`${theme.fg("dim", branch)} ${glyph} ${themeBold(theme, widgetJobName(job))} ${theme.fg("dim", "·")} ${details}`, width));
	}
	if (hidden > 0) lines.push(truncLine(theme.fg("dim", `└─ +${hidden} more`), width));
	return lines;
}

function buildWidgetComponent(jobs: AsyncJobState[], expanded: boolean): (_tui: unknown, theme: Theme) => Component {
	return (_tui, theme) => {
		const width = getTermWidth();
		const lines = expanded
			? buildWidgetLines(jobs, theme, width, true)
			: buildCompactStickyWidgetLines(jobs, theme, width);
		const container = new Container();
		for (const line of fitWidgetLineBudget(lines, theme, width, expanded)) container.addChild(new Text(line, 1, 0));
		return container;
	};
}
'''
    if "function widgetJobStatusText" not in read_text(path):
        replace_once(path, old, new, "compact sticky async widget")
    replace_once(
        path,
        "\tctx.ui.setWidget(WIDGET_KEY, buildWidgetComponent(jobs, ctx.ui.getToolsExpanded?.() ?? false));\n",
        "\tctx.ui.setWidget(WIDGET_KEY, buildWidgetComponent(jobs, ctx.ui.getToolsExpanded?.() ?? false), { placement: \"aboveEditor\" });\n",
        "async widget placement",
    )
    tracker_path = root / "src/runs/background/async-job-tracker.ts"
    tracker_text = read_text(tracker_path)
    tracker_old = "\t\t\tif (widgetChanged && state.lastUiContext?.hasUI) rerenderWidget(state.lastUiContext);\n"
    tracker_new = "\t\t\tconst hasRunningJobs = [...state.asyncJobs.values()].some((job) => job.status === \"running\");\n\t\t\tif ((widgetChanged || hasRunningJobs) && state.lastUiContext?.hasUI) rerenderWidget(state.lastUiContext);\n"
    if tracker_old in tracker_text:
        replace_once(tracker_path, tracker_old, tracker_new, "live async widget spinner repaint")
    elif tracker_new in tracker_text or "\t\t\tif (state.lastUiContext?.hasUI) rerenderWidget(state.lastUiContext);\n" in tracker_text:
        pass
    else:
        die(f"could not find compatible live async widget repaint point in {tracker_path}")


def main(argv):
    if len(argv) != 2:
        die("usage: pi-subagents-patch.py <pi-subagents-root>")

    root = pathlib.Path(argv[1])
    if not root.is_dir():
        die(f"not a directory: {root}")

    patch_child_environment(root)
    patch_output_instructions(root)
    patch_transient_provider_errors(root)
    patch_reviewer_default_reads(root)
    patch_forced_async_keeps_foreground_timeouts(root)
    patch_interrupt_escalation(root)
    patch_sticky_async_widget(root)


if __name__ == "__main__":
    main(sys.argv)
