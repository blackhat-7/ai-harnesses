{
  pkgs,
  lib,
  config,
  ...
}:
let
  home = config.home.homeDirectory;
  isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
  work = "${home}/Documents/Work/Editing/aftershoot-cloud";
  envCmd = "${home}/.npm-global/bin/env-cmd";
  readonlyBashSrc = builtins.fetchGit {
    url = "https://github.com/blackhat-7/readonly-bash.git";
    ref = "main";
  };
  readonlyBashPkg = pkgs.callPackage "${readonlyBashSrc}/package.nix" {
    defaultConfigPath = "${home}/.pi/agent/readonly-bash.json";
  };
  discardContext = builtins.unsafeDiscardStringContext;
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

  envMcp = env: bin: {
    command = envCmd;
    args = [
      "-f"
      "${work}/env/dev/${env}"
      "${work}/dist/mcp-servers/${bin}"
    ];
  };

  mcpServers = {
    bestiary = {
      command = "uvx";
      args = [
        "--with"
        "yt-dlp"
        "--from"
        "git+https://github.com/blackhat-7/bestiary.git@main"
        "bestiary"
        "serve"
      ];
    };
    github = {
      type = "http";
      url = "https://api.githubcopilot.com/mcp/";
      headers = {
        Authorization = "Bearer \${GITHUB_MCP_TOKEN}";
      };
    };
    chrome-devtools = {
      command = "npx";
      args = [
        "-y"
        "chrome-devtools-mcp@latest"
      ];
    };
    cloudsql-reader = envMcp "cloudsql-reader/app.env" "cloudsql-reader";
    grafana-loki-reader = envMcp "grafana-loki-reader/app.env" "grafana-loki-reader";
    mongo-reader = envMcp "mongo-reader/app.env" "mongo-reader";
    stage-mongo-reader = envMcp "mongo-reader/stage-app.env" "mongo-reader";
    sentry-reader = envMcp "sentry-reader/app.env" "sentry-reader";
    arxiv = {
      command = "arxiv-mcp-server";
      args = [ ];
      env = {
        ARXIV_STORAGE_PATH = "~/Downloads/papers";
      };
    };
    playwright = {
      command = "npx";
      args = [ "@playwright/mcp@latest" ];
    };
    linear = {
      command = "npx";
      args = [
        "-y"
        "@tacticlaunch/mcp-linear"
      ];
      env = {
        LINEAR_API_TOKEN = "\${LINEAR_API_KEY}";
      };
    };
  };

  opencodeEnabled = {
    bestiary = true;
    github = true;
    cloudsql-reader = true;
    arxiv = true;
  };
  piMcpServer =
    name: v:
    let
      base = builtins.removeAttrs v [ "disabled" ];
    in
    base
    // {
      lifecycle = v.lifecycle or "lazy";
    }
    // lib.optionalAttrs (name == "github") {
      headers = builtins.removeAttrs (base.headers or { }) [ "Authorization" ];
      auth = "bearer";
      bearerTokenEnv = "GITHUB_MCP_TOKEN";
    };
  piMcpServers = builtins.mapAttrs piMcpServer mcpServers;
  opencodeMcpServer =
    name: v:
    if v ? url then
      {
        type = "remote";
        url = v.url;
        enabled = opencodeEnabled.${name} or false;
      }
      // lib.optionalAttrs (v ? headers) {
        headers = builtins.mapAttrs (_: lib.replaceStrings [ "\${" "}" ] [ "{env:" "}" ]) v.headers;
      }
    else
      {
        type = "local";
        command = [ v.command ] ++ (v.args or [ ]);
        enabled = opencodeEnabled.${name} or false;
      }
      // lib.optionalAttrs (v ? env) { environment = v.env; };

  mcpNames = builtins.attrNames mcpServers;
  opencodeConfig = {
    "$schema" = "https://opencode.ai/config.json";
    permission = {
      "*" = "ask";
      bash = {
        "*" = "ask";
      };
      external_directory = "allow";
      websearch = "allow";
      glob = "allow";
      grep = "allow";
      list = "allow";
      lsp = "allow";
      read = "allow";
      task = "allow";
      todoread = "allow";
      todowrite = "allow";
      webfetch = "allow";
      skill = {
        "*" = "allow";
      };
    }
    // builtins.listToAttrs (
      map (name: {
        name = "${name}_*";
        value = "allow";
      }) mcpNames
    );
    provider.local-llm = {
      npm = "@ai-sdk/openai-compatible";
      name = "Local LLM";
      options = {
        baseURL = "http://100.64.0.1:6868/v1/";
        apiKey = "none";
      };
      models = {
        "qwen3.5-9b".name = "qwen3.5-9b";
        "gemma-4-26B-A4B".name = "gemma-4-26B-A4B";
      };
    };
    small_model = "github-copilot/gpt-5-mini";
    mcp = builtins.mapAttrs opencodeMcpServer mcpServers;
  };

  claudeMcpAllows = [
    "mcp__cloudsql-reader"
    "mcp__mongo-reader"
    "mcp__stage-mongo-reader"
    "mcp__grafana-loki-reader"
    "mcp__sentry-reader"
    "mcp__arxiv"
    "mcp__bestiary"
    "mcp__chrome-devtools"
    "mcp__github"
    "mcp__linear__linear_getViewer"
    "mcp__linear__linear_getOrganization"
    "mcp__linear__linear_getUsers"
    "mcp__linear__linear_getLabels"
    "mcp__linear__linear_getTeams"
    "mcp__linear__linear_getProjects"
    "mcp__linear__linear_getIssues"
    "mcp__linear__linear_getIssueById"
    "mcp__linear__linear_searchIssues"
    "mcp__linear__linear_getComments"
    "mcp__linear__linear_getProjectIssues"
    "mcp__linear__linear_getCycles"
    "mcp__linear__linear_getActiveCycle"
    "mcp__linear__linear_getInitiatives"
    "mcp__linear__linear_getInitiativeById"
    "mcp__linear__linear_getInitiativeProjects"
    "mcp__linear__linear_getIssueHistory"
  ];
  claudeSettings = {
    "$schema" = "https://json.schemastore.org/claude-code-settings.json";
    viewMode = "verbose";
    statusLine = {
      type = "command";
      command = "bash ${home}/.claude/statusline-command.sh";
    };
    permissions = {
      allow = [
        "Read"
        "Glob"
        "Grep"
        "LSP"
        "Task"
        "WebFetch"
        "WebSearch"
      ]
      ++ claudeMcpAllows;
      deny = [ ];
      ask = [
        "Edit"
        "Write"
      ];
    };
    enabledPlugins = {
      "pyright-lsp@claude-plugins-official" = true;
      "gopls-lsp@claude-plugins-official" = true;
    };
    hooks = builtins.listToAttrs (
      map
        (event: {
          name = event;
          value = [
            {
              matcher = "";
              hooks = [
                {
                  type = "command";
                  command = "bash ${home}/.claude/notify.sh";
                }
              ];
            }
          ];
        })
        [
          "Notification"
          "Stop"
        ]
    );
  };

  statuslineScript = ''
    #!/usr/bin/env bash
    input=$(cat)
    cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
    model=$(echo "$input" | jq -r '.model.display_name // ""')
    used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
    dir="''${cwd/#$HOME/~}"; IFS='/' read -ra parts <<< "$dir"; count="''${#parts[@]}"
    [ "$count" -gt 3 ] && dir="…/''${parts[$((count-3))]}/''${parts[$((count-2))]}/''${parts[$((count-1))]}"
    git_info=""
    if git_branch=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null); then
      flags=""; s=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)
      [ "$(echo "$s" | grep -c '^[MADRC]' || true)" -gt 0 ] && flags="''${flags}+"
      [ "$(echo "$s" | grep -c '^ M\| M' || true)" -gt 0 ] && flags="''${flags}!"
      [ "$(echo "$s" | grep -c '^??' || true)" -gt 0 ] && flags="''${flags}?"
      git_info=" on  ''${git_branch}"; [ -n "$flags" ] && git_info="''${git_info} [$flags]"
    fi
    python_info=""; [ -n "$VIRTUAL_ENV" ] && python_info=" via 🐍($(basename "$VIRTUAL_ENV"))"
    ctx_info=""; [ -n "$used_pct" ] && printf -v ctx_rounded "%.0f" "$used_pct" && ctx_info=" | ctx ''${ctx_rounded}%"
    model_info=""; [ -n "$model" ] && model_info=" | ''${model}"
    printf "\033[1;36m%s\033[0m" "$dir"; printf "\033[1;35m%s\033[0m" "$git_info"
    [ -n "$python_info" ] && printf "\033[1;33m%s\033[0m" "$python_info"
    printf "\033[0;37m%s%s\033[0m\n" "$ctx_info" "$model_info"
  '';

  notifyScript =
    if isDarwin then
      ''
        #!/usr/bin/env bash
        input=$(cat); event=$(printf '%s' "$input" | jq -r '.hook_event_name // ""'); cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
        session_id=$(printf '%s' "$input" | jq -r '.session_id // ""'); message=$(printf '%s' "$input" | jq -r '.message // ""')
        if [ "$event" = "Notification" ] && printf '%s' "$message" | grep -qiE "waiting for (your )?input"; then exit 0; fi
        front_bundle=$(lsappinfo info -only bundleid "$(lsappinfo front)" 2>/dev/null | cut -d'"' -f4)
        [ "$front_bundle" = "net.kovidgoyal.kitty" ] && exit 0
        label=$(basename "$cwd" 2>/dev/null); [ -z "$label" ] && label="claude"
        [ "$event" = "Stop" ] && message="Done"; title="Claude · $label"
        group="claude-code"; [ -n "$session_id" ] && group="claude-code-$session_id"
        args=(-title "$title" -message "$message" -group "$group"); [ -f "$HOME/.claude/icon.png" ] && args+=(-appIcon "$HOME/.claude/icon.png")
        ${pkgs.terminal-notifier}/bin/terminal-notifier "''${args[@]}"
      ''
    else
      ''
        #!/usr/bin/env bash
        input=$(cat); event=$(printf '%s' "$input" | jq -r '.hook_event_name // ""'); cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
        session_id=$(printf '%s' "$input" | jq -r '.session_id // ""'); label=$(basename "$cwd" 2>/dev/null); [ -z "$label" ] && label="claude"
        urgency="critical"; message=$(printf '%s' "$input" | jq -r '.message // ""'); [ "$event" = "Stop" ] && urgency="normal" && message="Done"
        args=(-u "$urgency" -a "Claude Code"); [ -f "$HOME/.claude/icon.png" ] && args+=(-i "$HOME/.claude/icon.png"); [ -n "$session_id" ] && args+=(-h "string:x-dunst-stack-tag:claude-$session_id")
        notify-send "''${args[@]}" "Claude · $label" "$message"
      '';

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
        apiKey: "CHUTES_API_KEY",
        api: "openai-completions",
        models,
      });
    }
  '';

  piSettings = builtins.toJSON {
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
  mcpConfig = builtins.toJSON {
    settings = {
      directTools = false;
    };
    mcpServers = piMcpServers;
  };
  opencodePackageJson = builtins.toJSON {
    private = true;
    type = "module";
    dependencies = {
      "@opencode-ai/plugin" = "latest";
    };
  };

  installPiActivation = ''
    export PATH="${pkgs.nodejs_24}/bin:$PATH"
    export npm_config_prefix="${home}/.npm-global"
    npm_bin="$npm_config_prefix/bin"
    mkdir -p "$npm_bin"
    packages="
      npm:pi-mcp-adapter
      npm:pi-permission-system
      npm:pi-web-access
      npm:pi-subagents
      npm:pi-mermaid
      npm:@juicesharp/rpiv-todo
      npm:@ifi/oh-pi-themes
      npm:pi-rewind
      npm:pi-intercom
    "

    npm i -g --no-audit --no-fund @earendil-works/pi-coding-agent env-cmd beautiful-mermaid || true

    settings="${home}/.pi/agent/settings.json"
    if [ -f "$settings" ]; then
      desired_json=$(printf '%s\n' $packages | ${pkgs.jq}/bin/jq -R . | ${pkgs.jq}/bin/jq -s .)
      ${pkgs.jq}/bin/jq --argjson packages "$desired_json" '.packages = $packages' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
    fi

    for package in $packages; do
      "$npm_bin/pi" install "$package" || true
    done

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
    """	// OUTPUT - prepend so agent knows where to write
	if (behavior.output) {
		const outputPath = resolveChainPath(behavior.output, chainDir);
		prefixParts.push(`[Write to: ''${outputPath}]`);
	}""",
    """	// OUTPUT - parent runner saves final response to this path
	if (behavior.output) {
		const outputPath = resolveChainPath(behavior.output, chainDir);
		prefixParts.push(`[Output will be saved by parent runner to: ''${outputPath}]`);
	}""",
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
    """	getFinalOutput,
	findLatestSessionFile,
	detectSubagentError,
	extractToolArgsPreview,""",
    """	getFinalOutput,
	findLatestSessionFile,
	detectSubagentError,
	hasCleanTerminalAssistantStop,
	extractToolArgsPreview,""",
)
patch(
    root / "src/runs/foreground/execution.ts",
    """	if (result.error && result.exitCode === 0) {
		result.exitCode = 1;
	}
	if (result.exitCode === 0 && !result.error) {""",
    """	if (result.error && result.exitCode === 0 && hasCleanTerminalAssistantStop(result.messages)) {
		result.error = undefined;
	}
	if (result.error && result.exitCode === 0) {
		result.exitCode = 1;
	}
	if (result.exitCode === 0 && !result.error) {""",
)
patch(
    root / "src/runs/background/subagent-runner.ts",
    """import { detectSubagentError, extractTextFromContent, extractToolArgsPreview, getFinalOutput } from "../../shared/utils.ts";""",
    """import { detectSubagentError, extractTextFromContent, extractToolArgsPreview, getFinalOutput, hasCleanTerminalAssistantStop } from "../../shared/utils.ts";""",
)
patch(
    root / "src/runs/background/subagent-runner.ts",
    """		const hiddenError = run.exitCode === 0 && !run.error ? detectSubagentError(run.messages) : null;""",
    """		if (run.error && run.exitCode === 0 && hasCleanTerminalAssistantStop(run.messages)) {
			run.error = undefined;
		}
		const hiddenError = run.exitCode === 0 && !run.error ? detectSubagentError(run.messages) : null;""",
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

  opencodeAgentReviewer = ''
    ---
    description: Independent fresh-context reviewer for flow tasks. Use for /audit-style reviews of ~/.flow/<slug>/PLAN.md against git diff; writes ~/.flow/<slug>/REVIEW.md with drift, bugs, bloat, missing items, and verdict.
    mode: subagent
    permission:
      edit: deny
      webfetch: deny
      task: deny
      todowrite: deny
      websearch: deny
      lsp: deny
      skill: deny
    ---
    You are an independent reviewer for the flow system. You have no prior context on this work. Your only inputs are the plan and actual diffs you read yourself. Be skeptical. Be specific. Cite file:line.

    Read PLAN.md fully, then run `git diff HEAD` in each touched repo. Cross-check every diff hunk against PLAN.md, every PLAN Changes line against the diff, and every PLAN edge case against real changed lines. Look for bugs, missed cases, bloat, out-of-scope changes, defensive code, backwards-compat shims, and mode-budget violations.

    Write `~/.flow/<slug>/REVIEW.md` with exactly:
    # Audit: <slug>
    Mode: <patch | clean | refactor>
    Repos: <repo1>, <repo2>, ...

    ## Plan-build drift
    Concrete deviations, or "None."

    ## Bugs
    Logic errors/missed edge cases with file:line, or "None."

    ## Bloat
    Untraceable or rule-violating hunks with file:line, or "None."

    ## Missing
    PLAN changes/edge cases with no diff support, or "None."

    ## Mode-specific
    Active-mode budget/new-file/justification checks, or "None."

    ## Verdict
    SHIP / NEEDS-FIXES / RE-PLAN, with one sentence why.

    End with: REVIEW.md written. Verdict: <SHIP | NEEDS-FIXES | RE-PLAN>.
  '';
in
{
  home.packages = [
    readonlyBashPkg
    pkgs.bash
  ] ++ piReadonlyBashTrustedPathPackages;

  home.activation.install-pi = lib.hm.dag.entryAfter [ "writeBoundary" ] installPiActivation;

  home.activation.writeAiHarnessConfigs = lib.hm.dag.entryAfter [ "writeBoundary" "install-pi" ] ''
    mkdir -p "$HOME/.config/opencode" "$HOME/.config/opencode/agent" "$HOME/.config/opencode/plugins" "$HOME/.claude" "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/extensions/pi-permission-system" "$HOME/.pi/agent/extensions/subagent" "$HOME/.config/mcp" "$HOME/.pi/agent/readonly-bash-approvals"
    chmod 700 "$HOME/.pi/agent/readonly-bash-approvals"
    rm -f "$HOME/.pi/agent/extensions/readonly-bash-classifier.js"
    rm -f "$HOME/.pi/agent/readonly-bash.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/readonly-bash.json"
    ${readonlyBashConfig}
    EOF
    rm -f "$HOME/.claude/statusline-command.sh"; cat <<'EOF' > "$HOME/.claude/statusline-command.sh"
    ${statuslineScript}
    EOF
    chmod +x "$HOME/.claude/statusline-command.sh"
    rm -f "$HOME/.claude/notify.sh"; cat <<'EOF' > "$HOME/.claude/notify.sh"
    ${notifyScript}
    EOF
    chmod +x "$HOME/.claude/notify.sh"
    rm -f "$HOME/.claude/settings.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.claude/settings.json"
    ${builtins.toJSON claudeSettings}
    EOF
    rm -f "$HOME/.claude.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.claude.json"
    ${builtins.toJSON { mcpServers = mcpServers; }}
    EOF
    rm -f "$HOME/.config/opencode/opencode.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/opencode/opencode.json"
    ${builtins.toJSON opencodeConfig}
    EOF
    rm -f "$HOME/.config/opencode/package.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/opencode/package.json"
    ${opencodePackageJson}
    EOF
    rm -f "$HOME/.config/opencode/plugins/readonly-bash.js"; cp "$HOME/dotfiles/ai-harnesses/readonly-bash-opencode-plugin.mjs" "$HOME/.config/opencode/plugins/readonly-bash.js"
    rm -f "$HOME/.config/opencode/agent/reviewer.md"; cat <<'EOF' > "$HOME/.config/opencode/agent/reviewer.md"
    ${opencodeAgentReviewer}
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
    rm -f "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/mcp/mcp.json"
    ${mcpConfig}
    EOF
    cp "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"
  '';
}
