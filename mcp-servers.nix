{
  lib,
  config,
  ...
}:
let
  home = config.home.homeDirectory;
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
in
{
  inherit mcpServers;
  piMcpServers = builtins.mapAttrs piMcpServer mcpServers;
}
