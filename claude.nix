{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit lib config; };
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
    text = builtins.replaceStrings [ "@defaultBaseUrl@" "@shim@" ] [
      config.aiHarnesses.claude.localModelBaseUrl
      "${./scripts/claude-local-shim.mjs}"
    ] (builtins.readFile ./scripts/claude-local.sh);
  };

  hasMcp = name: builtins.hasAttr name mcpData.mcpServers;
  claudeMcpAllows =
    lib.optionals (hasMcp "aftershoot-mcp") [ "mcp__aftershoot-mcp" ]
    ++ lib.optionals (hasMcp "bestiary") [ "mcp__bestiary" ]
    ++ lib.optionals (hasMcp "chrome-devtools") [ "mcp__chrome-devtools" ]
    ++ lib.optionals (hasMcp "github") [ "mcp__github" ]
    ++ lib.optionals (hasMcp "playwright") [ "mcp__playwright" ]
    ++ lib.optionals (hasMcp "atlassian") (
      map (tool: "mcp__atlassian__${tool}") mcpData.atlassianReadOnlyTools
    )
    ++ lib.optionals (hasMcp "linear") [
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
    statusLine = {
      type = "command";
      command = ''bash "$HOME/.claude/statusline-command.sh"'';
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
          deny = lib.optionals (hasMcp "atlassian") (
            map (tool: "mcp__atlassian__${tool}") mcpData.atlassianWriteTools
          );
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
    ${helpers.mergeJson "$HOME/.claude.json" { mcpServers = mcpData.mcpServers; }}
  '';
}
