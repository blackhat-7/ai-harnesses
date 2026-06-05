{
  pkgs,
  lib,
  config,
  ...
}:
let
  home = config.home.homeDirectory;
  isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
  mcpData = import ./mcp-servers.nix { inherit lib config; };
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

in
{
  home.activation.writeClaudeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.claude"
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
    ${builtins.toJSON { mcpServers = mcpData.mcpServers; }}
    EOF
  '';
}
