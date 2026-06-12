{ lib, ... }:

{
  imports = [
    ./pi.nix
    ./claude.nix
    ./opencode.nix
    ./mcp.nix
  ];

  options.aiHarnesses.mode = lib.mkOption {
    type = lib.types.enum [ "restricted" "yolo" ];
    default = "restricted";
    description = "Permission profile for generated AI harness configs.";
  };
}
