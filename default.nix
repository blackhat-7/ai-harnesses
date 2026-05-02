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

  piSettings = builtins.toJSON {
    skills = [ "${home}/.claude/skills" ];
    permissionLevel = "minimal";
    permissionMode = "ask";
    defaultProvider = "openai-codex";
    compaction = {
      enabled = true;
    };
  };
  piKeybindings = builtins.toJSON {
    "tui.input.newLine" = [
      "shift+enter"
      "alt+enter"
    ];
    "app.message.followUp" = [ "shift+alt+enter" ];
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
  home.activation.writeAiHarnessConfigs = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/opencode" "$HOME/.config/opencode/agent" "$HOME/.claude" "$HOME/.pi/agent" "$HOME/.config/mcp"
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
    rm -f "$HOME/.config/opencode/agent/reviewer.md"; cat <<'EOF' > "$HOME/.config/opencode/agent/reviewer.md"
    ${opencodeAgentReviewer}
    EOF
    pi_settings_tmp="$(mktemp)"; ${pkgs.jq}/bin/jq . <<'EOF' > "$pi_settings_tmp"
    ${piSettings}
    EOF
    if [[ -f "$HOME/.pi/agent/settings.json" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1] | del(.enabledModels)' "$HOME/.pi/agent/settings.json" "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    else
      ${pkgs.jq}/bin/jq 'del(.enabledModels)' "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    fi
    mv "$HOME/.pi/agent/settings.json.tmp" "$HOME/.pi/agent/settings.json"; rm -f "$pi_settings_tmp"
    rm -f "$HOME/.pi/agent/keybindings.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.pi/agent/keybindings.json"
    ${piKeybindings}
    EOF
    rm -f "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/mcp/mcp.json"
    ${mcpConfig}
    EOF
    cp "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"
  '';
}
