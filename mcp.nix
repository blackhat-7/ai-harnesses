{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit lib config; };
  mcpConfig = {
    settings.directTools = false;
    mcpServers = mcpData.piMcpServers;
  };
in
{
  home.activation.writeMcpConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/mcp"
    ${helpers.writeJson "$HOME/.config/mcp/mcp.json" mcpConfig}
    rm -f "$HOME/.config/mcp/mcp.catalog.json"
    cp "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"
  '';
}
