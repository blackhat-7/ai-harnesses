{ lib, ... }:

{
  imports = [
    ./pi.nix
    ./claude.nix
    ./opencode.nix
    ./mcp.nix
  ];

  config.home.file = lib.genAttrs [
    ".claude/CLAUDE.md"
    ".codex/AGENTS.md"
    ".config/opencode/AGENTS.md"
    ".pi/agent/AGENTS.md"
    ".gemini/GEMINI.md"
  ] (_: {
    source = ./files/AGENTS.md;
  });

  options.aiHarnesses = {
    mode = lib.mkOption {
      type = lib.types.enum [ "restricted" "yolo" ];
      default = "restricted";
      description = "Permission profile for generated AI harness configs.";
    };

    mcp = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to generate and load MCP server configs.";
      };
      enabledServers = lib.mkOption {
        type = lib.types.nullOr (lib.types.listOf lib.types.str);
        default = null;
        description = "MCP server names to enable. null means all known servers.";
      };
    };

    pi.disabledPackages = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Pi package sources to omit, uninstall, and skip package-specific setup for.";
    };
  };
}
