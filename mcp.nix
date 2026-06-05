{
  pkgs,
  lib,
  config,
  ...
}:
let
  mcpData = import ./mcp-servers.nix { inherit lib config; };
  mcpConfig = builtins.toJSON {
    settings = {
      directTools = false;
    };
    mcpServers = mcpData.piMcpServers;
  };
in
{
  home.activation.writeMcpConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/mcp"
    rm -f "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/mcp/mcp.json"
    ${mcpConfig}
    EOF
    cp "$HOME/.config/mcp/mcp.json" "$HOME/.config/mcp/mcp.catalog.json"
  '';
}
