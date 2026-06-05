{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit lib config; };

  opencodeEnabled = {
    bestiary = true;
    github = true;
    cloudsql-reader = true;
    arxiv = true;
  };
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

  opencodeConfig = {
    "$schema" = "https://opencode.ai/config.json";
    permission = {
      "*" = "ask";
      bash."*" = "ask";
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
      skill."*" = "allow";
    }
    // builtins.listToAttrs (
      map (name: {
        name = "${name}_*";
        value = "allow";
      }) (builtins.attrNames mcpData.mcpServers)
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
    mcp = builtins.mapAttrs opencodeMcpServer mcpData.mcpServers;
  };
  opencodePackageJson = {
    private = true;
    type = "module";
    dependencies."@opencode-ai/plugin" = "latest";
  };
in
{
  home.activation.writeOpencodeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/opencode" "$HOME/.config/opencode/agent" "$HOME/.config/opencode/plugins"
    ${helpers.writeJson "$HOME/.config/opencode/opencode.json" opencodeConfig}
    ${helpers.writeJson "$HOME/.config/opencode/package.json" opencodePackageJson}
    ${helpers.copyFile "$HOME/.config/opencode/plugins/readonly-bash.js" ./readonly-bash-opencode-plugin.mjs}
    ${helpers.copyFile "$HOME/.config/opencode/agent/reviewer.md" ./files/opencode-reviewer.md}
  '';
}
