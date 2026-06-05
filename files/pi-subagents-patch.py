#!/usr/bin/env python3
import pathlib
import sys

root = pathlib.Path(sys.argv[1])


def patch(path, old, new):
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Could not apply pi-subagents safety patch to {path}")
    path.write_text(text.replace(old, new))


patch(
    root / "src/runs/shared/pi-args.ts",
    '\tconst env: Record<string, string | undefined> = {};\n\tenv[SUBAGENT_CHILD_ENV] = "1";',
    '\tconst env: Record<string, string | undefined> = {};\n\tenv[SUBAGENT_CHILD_ENV] = "1";\n\tenv.PI_IS_SUBAGENT = "1";',
)
patch(
    root / "src/extension/index.ts",
    '\tconst resetSessionState = (ctx: ExtensionContext) => {\n\t\tstate.baseCwd = ctx.cwd;\n\t\tstate.currentSessionId = resolveCurrentSessionId(ctx.sessionManager);\n\t\tstate.lastUiContext = ctx;',
    '\tconst resetSessionState = (ctx: ExtensionContext) => {\n\t\tstate.baseCwd = ctx.cwd;\n\t\tstate.currentSessionId = resolveCurrentSessionId(ctx.sessionManager);\n\t\tprocess.env.PI_AGENT_ROUTER_PARENT_SESSION_ID = ctx.sessionManager.getSessionId() ?? "";\n\t\tstate.lastUiContext = ctx;',
)

# Output paths are owned by the parent runner. Children should return final
# content; asking them to write the file triggers permission prompts in headless
# child processes and can deadlock review workflows.
patch(
    root / "src/runs/shared/single-output.ts",
    """export function injectSingleOutputInstruction(task: string, outputPath: string | undefined): string {
	if (!outputPath) return task;
	return `${task}\\n\\n---\\n**Output:** Write your findings to: ${outputPath}`;
}""",
    """export function injectSingleOutputInstruction(task: string, outputPath: string | undefined): string {
	if (!outputPath) return task;
	return `${task}\\n\\n---\\n**Output:** Return your findings in your final response. Do not call write/edit for this output file; the parent subagent runner will save your final response to: ${outputPath}`;
}""",
)
patch(
    root / "src/shared/settings.ts",
    """\t// OUTPUT - prepend so agent knows where to write
\tif (behavior.output) {
\t\tconst outputPath = resolveChainPath(behavior.output, chainDir);
\t\tprefixParts.push(`[Write to: ${outputPath}]`);
\t}""",
    """\t// OUTPUT - parent runner saves final response to this path
\tif (behavior.output) {
\t\tconst outputPath = resolveChainPath(behavior.output, chainDir);
\t\tprefixParts.push(`[Output will be saved by parent runner to: ${outputPath}]`);
\t}""",
)

# pi can emit an assistant message with errorMessage for a transient provider
# transport failure and then recover with a later clean terminal answer. Do not
# let pi-subagents treat the earlier transient message as a failed subagent run.
patch(
    root / "src/shared/utils.ts",
    """/**
 * Detect errors in subagent execution from messages (only errors with no subsequent success)
 */
export function detectSubagentError(messages: Message[]): ErrorInfo {""",
    """/**
 * Returns true when the latest assistant turn completed cleanly.
 *
 * Provider transport errors can be emitted as assistant messages before pi
 * retries/resumes and produces a later final answer. Subagent runners should
 * not keep an older assistant error latched after this clean terminal turn.
 */
export function hasCleanTerminalAssistantStop(messages: Message[]): boolean {
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

/**
 * Detect errors in subagent execution from messages (only errors with no subsequent success)
 */
export function detectSubagentError(messages: Message[]): ErrorInfo {""",
)
patch(
    root / "src/runs/foreground/execution.ts",
    """\tgetFinalOutput,
\tfindLatestSessionFile,
\tdetectSubagentError,
\textractToolArgsPreview,""",
    """\tgetFinalOutput,
\tfindLatestSessionFile,
\tdetectSubagentError,
\thasCleanTerminalAssistantStop,
\textractToolArgsPreview,""",
)
patch(
    root / "src/runs/foreground/execution.ts",
    """\tif (result.error && result.exitCode === 0) {
\t\tresult.exitCode = 1;
\t}
\tif (result.exitCode === 0 && !result.error) {""",
    """\tif (result.error && result.exitCode === 0 && hasCleanTerminalAssistantStop(result.messages)) {
\t\tresult.error = undefined;
\t}
\tif (result.error && result.exitCode === 0) {
\t\tresult.exitCode = 1;
\t}
\tif (result.exitCode === 0 && !result.error) {""",
)
patch(
    root / "src/runs/background/subagent-runner.ts",
    """getFinalOutput } from "../../shared/utils.ts";""",
    """getFinalOutput, hasCleanTerminalAssistantStop } from "../../shared/utils.ts";""",
)
patch(
    root / "src/runs/background/subagent-runner.ts",
    """\t\tconst hiddenError = run.exitCode === 0 && !run.error ? detectSubagentError(run.messages) : null;""",
    """\t\tif (run.error && run.exitCode === 0 && hasCleanTerminalAssistantStop(run.messages)) {
\t\t\trun.error = undefined;
\t\t}
\t\tconst hiddenError = run.exitCode === 0 && !run.error ? detectSubagentError(run.messages) : null;""",
)
