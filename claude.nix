{
  pkgs,
  lib,
  config,
  ...
}:
let
  isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit lib config; };

  notifyScript =
    if isDarwin then
      pkgs.replaceVars ./files/claude-notify-darwin.sh {
        terminalNotifier = "${pkgs.terminal-notifier}/bin/terminal-notifier";
      }
    else
      ./files/claude-notify-linux.sh;

  claudeMcpAllows = [
    "mcp__aftershoot-mcp"
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
      command = ''bash "$HOME/.claude/statusline-command.sh"'';
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
      ] ++ claudeMcpAllows;
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
                  command = ''bash "$HOME/.claude/notify.sh"'';
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
in
{
  home.activation.writeClaudeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.claude"
    ${helpers.copyFile "$HOME/.claude/statusline-command.sh" ./files/claude-statusline.sh}
    chmod +x "$HOME/.claude/statusline-command.sh"
    ${helpers.copyFile "$HOME/.claude/notify.sh" notifyScript}
    chmod +x "$HOME/.claude/notify.sh"
    ${helpers.writeJson "$HOME/.claude/settings.json" claudeSettings}
    ${helpers.writeJson "$HOME/.claude.json" { mcpServers = mcpData.mcpServers; }}
  '';
}
