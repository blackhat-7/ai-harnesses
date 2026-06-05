{ pkgs }:
let
  jq = "${pkgs.jq}/bin/jq";
in
{
  writeJson = path: value: ''
    rm -f "${path}"
    ${jq} . <<'EOF' > "${path}"
    ${builtins.toJSON value}
    EOF
  '';

  copyFile = path: source: ''
    rm -f "${path}"
    cp ${source} "${path}"
    chmod 0644 "${path}"
  '';
}
