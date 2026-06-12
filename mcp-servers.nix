{
  lib,
  config,
  ...
}:
let
  mcpEnable = config.aiHarnesses.mcp.enable or true;
  selectedServers = config.aiHarnesses.mcp.enabledServers or null;

  allMcpServers = {
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
    aftershoot-mcp = {
      type = "http";
      url = "https://mcp-gateway.aftershoot.dev/mcp";
      headers = {
        Authorization = "Bearer \${AFTERSHOOT_MCP_API_KEY}";
      };
    };
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

  unknownServers =
    if selectedServers == null then
      [ ]
    else
      builtins.filter (name: !(builtins.hasAttr name allMcpServers)) selectedServers;
  mcpServers =
    assert lib.assertMsg (unknownServers == [ ])
      "Unknown aiHarnesses.mcp.enabledServers: ${builtins.concatStringsSep ", " unknownServers}";
    if !mcpEnable then
      { }
    else if selectedServers == null then
      allMcpServers
    else
      lib.filterAttrs (name: _: builtins.elem name selectedServers) allMcpServers;

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
    }
    // lib.optionalAttrs (name == "aftershoot-mcp") {
      headers = builtins.removeAttrs (base.headers or { }) [ "Authorization" ];
      auth = "bearer";
      bearerTokenEnv = "AFTERSHOOT_MCP_API_KEY";
    };
in
{
  inherit mcpServers;
  piMcpServers = builtins.mapAttrs piMcpServer mcpServers;
}
