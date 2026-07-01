{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit lib config; };
  isYolo = (config.aiHarnesses.mode or "restricted") == "yolo";

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
    viewMode = "verbose";
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
          ask = [
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
  home.activation.writeClaudeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.claude"
    ${helpers.copyFile "$HOME/.claude/statusline-command.sh" ./scripts/claude-statusline.sh}
    chmod +x "$HOME/.claude/statusline-command.sh"
    rm -f "$HOME/.claude/notify.sh"
    ${helpers.writeJson "$HOME/.claude/settings.json" claudeSettings}
    ${helpers.writeJson "$HOME/.claude.json" { mcpServers = mcpData.mcpServers; }}
  '';
}
