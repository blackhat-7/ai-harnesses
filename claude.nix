{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit pkgs lib config; };
  mode = config.aiHarnesses.mode or "restricted";
  isYolo = mode == "yolo";
  isRestricted = mode == "restricted";

  # `claude` itself keeps its own Anthropic login; this wrapper only sets a
  # local endpoint for the sessions it starts. Models are discovered at runtime.
  claudeLocal = pkgs.writeShellApplication {
    name = "claude-local";
    runtimeInputs = [
      pkgs.curl
      pkgs.jq
      pkgs.gnugrep
      pkgs.nodejs
    ];
    text = builtins.replaceStrings [ "@defaultBaseUrl@" "@shim@" "@notes@" ] [
      config.aiHarnesses.claude.localModelBaseUrl
      "${./scripts/claude-local-shim.mjs}"
      "${./files/claude-local-notes.md}"
    ] (builtins.readFile ./scripts/claude-local.sh);
  };

  # Claude Code reaches Atlassian, Slack and Gmail through claude.ai connectors, so the
  # local MCP servers would only duplicate them (slack and gmail would call Claude Code itself).
  claudeMcpServers = builtins.removeAttrs mcpData.mcpServers [
    "atlassian"
    "slack"
    "gmail"
  ];

  hasMcp = name: builtins.hasAttr name claudeMcpServers;
  claudeMcpAllows =
    lib.optionals (hasMcp "aftershoot-mcp") [ "mcp__aftershoot-mcp" ]
    ++ lib.optionals (hasMcp "bestiary") [ "mcp__bestiary" ]
    ++ lib.optionals (hasMcp "firefox-devtools") [ "mcp__firefox-devtools" ]
    ++ lib.optionals (hasMcp "playwright") [ "mcp__playwright" ];

  claudeSettings = {
    "$schema" = "https://json.schemastore.org/claude-code-settings.json";
    statusLine = {
      type = "command";
      command = ''bash "$HOME/.claude/statusline-command.sh"'';
    };
    attribution = {
      commit = "";
      pr = "";
    };
    permissions =
      if isYolo then
        {
          defaultMode = "bypassPermissions";
        }
      else
        {
          # Only user-level settings can start a session in auto mode, and
          # activation rewrites this file, so it has to live here.
          defaultMode = "auto";
          allow = [
            "Read"
            "Glob"
            "Grep"
            "LSP"
            "Task"
            "WebFetch"
            "WebSearch"
          ] ++ claudeMcpAllows;
          ask = lib.optionals isRestricted [
            "Edit"
            "Write"
          ];
        };
    enabledPlugins = {
      "pyright-lsp@claude-plugins-official" = true;
      "gopls-lsp@claude-plugins-official" = true;
    };
  };
in
{
  home.packages = [ claudeLocal ];

  home.activation.writeClaudeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.claude"
    ${helpers.copyFile "$HOME/.claude/statusline-command.sh" ./scripts/claude-statusline.sh}
    chmod +x "$HOME/.claude/statusline-command.sh"
    rm -f "$HOME/.claude/notify.sh"
    ${helpers.writeJson "$HOME/.claude/settings.json" claudeSettings}
    ${helpers.mergeJson "$HOME/.claude.json" { mcpServers = claudeMcpServers; }}
  '';
}
