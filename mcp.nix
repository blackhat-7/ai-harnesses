{
  pkgs,
  lib,
  config,
  ...
}:
let
  helpers = import ./helpers.nix { inherit pkgs; };
  mcpData = import ./mcp-servers.nix { inherit pkgs lib config; };
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

  # Install only when missing; `just update` in dotfiles does the upgrades.
  home.activation.installMcpTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    export PATH=${lib.makeBinPath [ pkgs.git ]}:$PATH
    ${lib.concatStrings (
      lib.mapAttrsToList (name: source: ''
        [ -x "$HOME/.local/bin/${name}" ] || run ${pkgs.uv}/bin/uv tool install ${source} \
          || echo "warning: could not install ${name}; its MCP server won't start" >&2
      '') mcpData.uvTools
    )}
  '';
}
