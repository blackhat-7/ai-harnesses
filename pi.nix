{
  pkgs,
  lib,
  config,
  ...
}:
let
  home = config.home.homeDirectory;
  discardContext = builtins.unsafeDiscardStringContext;

  readonlyBashSrc = builtins.fetchGit {
    url = "https://github.com/blackhat-7/readonly-bash.git";
    ref = "main";
  };
  readonlyBashPkg = pkgs.callPackage "${readonlyBashSrc}/package.nix" {
    defaultConfigPath = "${home}/.pi/agent/readonly-bash.json";
  };
  readonlyBashCli = "${readonlyBashPkg}/bin/readonly-bash";
  readonlyBashRunnerCommand = "${readonlyBashPkg}/bin/readonly-bash-runner";
  readonlyBashCliString = discardContext readonlyBashCli;
  readonlyBashRunnerCommandString = discardContext readonlyBashRunnerCommand;

  piReadonlyBashTrustedShell = "${pkgs.bash}/bin/bash";
  piReadonlyBashTrustedShellString = discardContext piReadonlyBashTrustedShell;
  piReadonlyBashTrustedPathPackages = [
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.ripgrep
    pkgs.git
    pkgs.file
    pkgs.gnused
    pkgs.gawk
    pkgs.nodejs
    pkgs.python3
  ];
  piReadonlyBashTrustedPath = lib.makeBinPath piReadonlyBashTrustedPathPackages;
  piReadonlyBashTrustedPathString = discardContext piReadonlyBashTrustedPath;

  piNpmCommand = [
    "npm"
    "--no-audit"
    "--no-fund"
  ];
  piPackages = [
    "npm:pi-mcp-adapter"
    "npm:pi-permission-system"
    "npm:pi-web-access"
    "npm:pi-subagents"
    "npm:pi-mermaid"
    "npm:@juicesharp/rpiv-todo"
    "npm:@ifi/oh-pi-themes"
    "npm:pi-opencode-theme"
    "npm:pi-rewind"
    "npm:pi-intercom"
  ];
  piPackagesJson = builtins.toJSON piPackages;
  piNpmCommandJson = builtins.toJSON piNpmCommand;

  readonlyBashConfig = builtins.toJSON {
    cliPath = readonlyBashCliString;
    runnerPath = readonlyBashRunnerCommandString;
    approvalDir = "${home}/.pi/agent/readonly-bash-approvals";
    trustedShell = piReadonlyBashTrustedShellString;
    trustedPath = piReadonlyBashTrustedPathString;
    globalSettingsPath = "${home}/.pi/agent/settings.json";
    projectSettingsLookup = "cwd";
    generatedPermissionsPath = "${home}/.pi/agent/pi-permissions.jsonc";
  };

  piChutesProviderExtension = ''
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

    type ChutesModel = {
      id: string;
      name?: string;
      pricing?: {
        prompt?: number;
        completion?: number;
        input_cache_read?: number;
      };
      price?: {
        input?: { usd?: number };
        output?: { usd?: number };
        input_cache_read?: { usd?: number };
      };
      max_model_len?: number;
      max_tokens?: number;
    };

    type ChutesModelsResponse = {
      data?: ChutesModel[];
    };

    const CHUTES_BASE_URL = "https://llm.chutes.ai/v1";

    function price(model: ChutesModel, key: "input" | "output" | "input_cache_read", fallbackKey: "prompt" | "completion" | "input_cache_read") {
      return model.price?.[key]?.usd ?? model.pricing?.[fallbackKey] ?? 0;
    }

    export default async function (pi: ExtensionAPI) {
      const response = await fetch(CHUTES_BASE_URL + "/models");
      if (!response.ok) throw new Error("Failed to fetch Chutes models: " + response.status + " " + response.statusText);

      const payload = (await response.json()) as ChutesModelsResponse;
      const models = (payload.data ?? []).map((model) => {
        const contextWindow = model.max_model_len ?? 128000;

        return {
          id: model.id,
          name: model.name ?? model.id,
          reasoning: false,
          input: ["text"] as const,
          cost: {
            input: price(model, "input", "prompt"),
            output: price(model, "output", "completion"),
            cacheRead: price(model, "input_cache_read", "input_cache_read"),
            cacheWrite: 0,
          },
          contextWindow,
          maxTokens: model.max_tokens ?? Math.min(contextWindow, 16384),
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
        };
      });

      pi.registerProvider("chutes", {
        name: "Chutes",
        baseUrl: CHUTES_BASE_URL,
        apiKey: "$CHUTES_API_KEY",
        api: "openai-completions",
        models,
      });
    }
  '';

  piSettings = builtins.toJSON {
    packages = piPackages;
    npmCommand = piNpmCommand;
    skills = [ "${home}/.claude/skills" ];
    extensions = [ "${home}/dotfiles/ai-harnesses/readonly-bash-classifier.js" ];
    shellPath = piReadonlyBashTrustedShellString;
    shellCommandPrefix = "";
    defaultProvider = "openai-codex";
    enabledModels = [
      "openai-codex/*"
      "chutes/**"
    ];
    compaction = {
      enabled = true;
    };
  };
  piPermissionPolicy = builtins.toJSON {
    defaultPolicy = {
      tools = "ask";
      bash = "ask";
      mcp = "allow";
      skills = "allow";
      special = "ask";
    };
    bash = {
      "${readonlyBashRunnerCommandString}" = "allow";
      "READONLY_BASH_REQUEST_ID=* ${readonlyBashRunnerCommandString}" = "allow";
    };
    tools = {
      read = "allow";
      grep = "allow";
      find = "allow";
      ls = "allow";
      mcp = "allow";
      web_search = "allow";
      fetch_content = "allow";
      get_search_content = "allow";
      code_search = "allow";
      todo = "allow";
      subagent = "allow";
      intercom = "allow";
      contact_supervisor = "allow";
      bash = "ask";
      write = "ask";
      edit = "ask";
    };
    special = {
      doom_loop = "deny";
      external_directory = "allow";
    };
  };
  piPermissionSystemConfig = builtins.toJSON {
    debugLog = false;
    permissionReviewLog = true;
    yoloMode = false;
  };
  piSubagentsConfig = builtins.toJSON {
    intercomBridge = {
      mode = "off";
    };
  };
  piKeybindings = builtins.toJSON {
    "tui.input.newLine" = [
      "shift+enter"
      "alt+enter"
    ];
    "app.message.followUp" = [ "shift+alt+enter" ];
  };
  piWebSearchConfig = builtins.toJSON {
    provider = "exa";
    workflow = "none";
    allowBrowserCookies = false;
    youtube.enabled = false;
    video.enabled = false;
  };

  installPiActivation = ''
    export PATH="${pkgs.nodejs_24}/bin:$PATH"
    export npm_config_prefix="${home}/.npm-global"
    npm_bin="$npm_config_prefix/bin"
    mkdir -p "$npm_bin"

    npm i -g --no-audit --no-fund @earendil-works/pi-coding-agent env-cmd beautiful-mermaid || true

    settings="${home}/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings")"
    pi_packages_json='${piPackagesJson}'
    pi_npm_command_json='${piNpmCommandJson}'
    if [ -f "$settings" ]; then
      ${pkgs.jq}/bin/jq --argjson packages "$pi_packages_json" --argjson npmCommand "$pi_npm_command_json" '.packages = $packages | .npmCommand = $npmCommand' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
    else
      ${pkgs.jq}/bin/jq -n --argjson packages "$pi_packages_json" --argjson npmCommand "$pi_npm_command_json" '{packages: $packages, npmCommand: $npmCommand}' > "$settings"
    fi

    "$npm_bin/pi" update --extensions || true

    subagents_roots="${home}/.npm-global/lib/node_modules/pi-subagents ${home}/.pi/agent/npm/node_modules/pi-subagents"
    for subagents_root in $subagents_roots; do
      [ -d "$subagents_root" ] || continue
      ${pkgs.python3}/bin/python3 - "$subagents_root" <<'PY'
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
	return `''${task}\\n\\n---\\n**Output:** Write your findings to: ''${outputPath}`;
}""",
    """export function injectSingleOutputInstruction(task: string, outputPath: string | undefined): string {
	if (!outputPath) return task;
	return `''${task}\\n\\n---\\n**Output:** Return your findings in your final response. Do not call write/edit for this output file; the parent subagent runner will save your final response to: ''${outputPath}`;
}""",
)
patch(
    root / "src/shared/settings.ts",
    """\t// OUTPUT - prepend so agent knows where to write
\tif (behavior.output) {
\t\tconst outputPath = resolveChainPath(behavior.output, chainDir);
\t\tprefixParts.push(`[Write to: ''${outputPath}]`);
\t}""",
    """\t// OUTPUT - parent runner saves final response to this path
\tif (behavior.output) {
\t\tconst outputPath = resolveChainPath(behavior.output, chainDir);
\t\tprefixParts.push(`[Output will be saved by parent runner to: ''${outputPath}]`);
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
PY
      rm -rf "$subagents_root/node_modules/.cache/jiti"
    done

    permission_system_roots="${home}/.npm-global/lib/node_modules/pi-permission-system ${home}/.pi/agent/npm/node_modules/pi-permission-system"
    for permission_system_root in $permission_system_roots; do
      [ -d "$permission_system_root" ] || continue
      ${pkgs.python3}/bin/python3 - "$permission_system_root" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
path = root / "src/permission-forwarding.ts"
text = path.read_text()
old = 'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;'
new = 'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;'
if new not in text:
    if old not in text:
        raise SystemExit(f"Could not apply pi-permission-system subagent env patch to {path}")
    path.write_text(text.replace(old, new))
PY
      rm -rf "$permission_system_root/node_modules/.cache/jiti"
    done
  '';
in
{
  home.packages = [
    readonlyBashPkg
    pkgs.bash
  ] ++ piReadonlyBashTrustedPathPackages;

  home.activation.install-pi = lib.hm.dag.entryAfter [ "writeBoundary" ] installPiActivation;

  home.activation.writePiConfigs = lib.hm.dag.entryAfter [ "writeBoundary" "install-pi" ] ''
    mkdir -p "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/extensions/pi-permission-system" "$HOME/.pi/agent/extensions/subagent" "$HOME/.pi/agent/readonly-bash-approvals"
    chmod 700 "$HOME/.pi/agent/readonly-bash-approvals"
    rm -f "$HOME/.pi/agent/extensions/readonly-bash-classifier.js"
    rm -f "$HOME/.pi/agent/readonly-bash.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/readonly-bash.json"
    ${readonlyBashConfig}
    EOF
    pi_settings_tmp="$(mktemp)"; ${pkgs.jq}/bin/jq . <<'EOF' > "$pi_settings_tmp"
    ${piSettings}
    EOF
    if [[ -f "$HOME/.pi/agent/settings.json" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1] | del(.permissionLevel, .permissionMode)' "$HOME/.pi/agent/settings.json" "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    else
      ${pkgs.jq}/bin/jq '. | del(.permissionLevel, .permissionMode)' "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    fi
    mv "$HOME/.pi/agent/settings.json.tmp" "$HOME/.pi/agent/settings.json"; rm -f "$pi_settings_tmp"
    rm -f "$HOME/.pi/agent/pi-permissions.jsonc"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/pi-permissions.jsonc"
    ${piPermissionPolicy}
    EOF
    rm -f "$HOME/.pi/agent/extensions/pi-permission-system/config.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/extensions/pi-permission-system/config.json"
    ${piPermissionSystemConfig}
    EOF
    rm -f "$HOME/.pi/agent/extensions/subagent/config.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/extensions/subagent/config.json"
    ${piSubagentsConfig}
    EOF
    rm -f "$HOME/.pi/agent/extensions/chutes-provider.ts"; cat <<'EOF' > "$HOME/.pi/agent/extensions/chutes-provider.ts"
    ${piChutesProviderExtension}
    EOF
    rm -f "$HOME/.pi/agent/keybindings.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/keybindings.json"
    ${piKeybindings}
    EOF
    rm -f "$HOME/.pi/web-search.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/web-search.json"
    ${piWebSearchConfig}
    EOF
  '';
}
