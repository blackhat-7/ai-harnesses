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

  # Like writeJson, but keeps top-level keys the file already has. Used for
  # files an app owns at runtime (~/.claude.json holds the login session), where
  # a plain overwrite would log the user out on every activation.
  mergeJson = path: value: ''
    ${jq} . <<'EOF' > "${path}.new"
    ${builtins.toJSON value}
    EOF
    if [ -s "${path}" ] && ${jq} -e . "${path}" > /dev/null 2>&1; then
      ${jq} -s '.[0] + .[1]' "${path}" "${path}.new" > "${path}.merged"
      mv "${path}.merged" "${path}"
      rm -f "${path}.new"
    else
      mv "${path}.new" "${path}"
    fi
  '';

  copyFile = path: source: ''
    rm -f "${path}"
    cp ${source} "${path}"
    chmod 0644 "${path}"
  '';
}
