{
  pkgs,
  lib,
  config,
  ...
}:
let
  home = config.home.homeDirectory;
  discardContext = builtins.unsafeDiscardStringContext;
  helpers = import ./helpers.nix { inherit pkgs; };

  readonlyBashSrc = builtins.fetchGit {
    url = "https://github.com/blackhat-7/readonly-bash.git";
    ref = "main";
  };
  readonlyBashPkg = pkgs.callPackage "${readonlyBashSrc}/package.nix" {
    defaultConfigPath = "${home}/.pi/agent/readonly-bash.json";
  };

  readonlyBashCliString = discardContext "${readonlyBashPkg}/bin/readonly-bash";
  readonlyBashRunnerCommandString = discardContext "${readonlyBashPkg}/bin/readonly-bash-runner";
  piReadonlyBashTrustedShellString = discardContext "${pkgs.bash}/bin/bash";
  piReadonlyBashTrustedPathPackages = [
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.ripgrep
    pkgs.git
    pkgs.file
    pkgs.gnused
    pkgs.gawk
    pkgs.nodejs
    pkgs.python3
  ];
  piReadonlyBashTrustedPathString = discardContext (lib.makeBinPath piReadonlyBashTrustedPathPackages);

  piNpmCommand = [
    "npm"
    "--no-audit"
    "--no-fund"
  ];
  piPackages = [
    "npm:pi-mcp-adapter"
    "npm:pi-permission-system"
    "npm:pi-web-access"
    "npm:pi-subagents"
    "npm:pi-mermaid"
    "npm:@juicesharp/rpiv-todo"
    "npm:@ifi/oh-pi-themes"
    "npm:pi-opencode-theme"
    "npm:pi-rewind"
    "npm:pi-intercom"
    "npm:pi-vim"
  ];

  readonlyBashConfig = {
    cliPath = readonlyBashCliString;
    runnerPath = readonlyBashRunnerCommandString;
    approvalDir = "${home}/.pi/agent/readonly-bash-approvals";
    trustedShell = piReadonlyBashTrustedShellString;
    trustedPath = piReadonlyBashTrustedPathString;
    globalSettingsPath = "${home}/.pi/agent/settings.json";
    projectSettingsLookup = "cwd";
    generatedPermissionsPath = "${home}/.pi/agent/pi-permissions.jsonc";
  };

  piSettings = {
    packages = piPackages;
    npmCommand = piNpmCommand;
    skills = [ "${home}/.claude/skills" ];
    extensions = [ "${home}/dotfiles/ai-harnesses/readonly-bash-classifier.js" ];
    shellPath = piReadonlyBashTrustedShellString;
    shellCommandPrefix = "";
    defaultProvider = "openai-codex";
    enabledModels = [
      "openai-codex/*"
      "chutes/**"
    ];
    compaction.enabled = true;
  };
  piPermissionPolicy = {
    defaultPolicy = {
      tools = "ask";
      bash = "ask";
      mcp = "allow";
      skills = "allow";
      special = "ask";
    };
    bash = {
      "${readonlyBashRunnerCommandString}" = "allow";
      "READONLY_BASH_REQUEST_ID=* ${readonlyBashRunnerCommandString}" = "allow";
    };
    tools = {
      read = "allow";
      grep = "allow";
      find = "allow";
      ls = "allow";
      mcp = "allow";
      web_search = "allow";
      fetch_content = "allow";
      get_search_content = "allow";
      code_search = "allow";
      todo = "allow";
      subagent = "allow";
      intercom = "allow";
      contact_supervisor = "allow";
      bash = "ask";
      write = "ask";
      edit = "ask";
    };
    special = {
      doom_loop = "deny";
      external_directory = "allow";
    };
  };
  piPermissionSystemConfig = {
    debugLog = false;
    permissionReviewLog = true;
    yoloMode = false;
  };
  piSubagentsConfig.intercomBridge.mode = "off";
  piKeybindings = {
    "tui.input.newLine" = [
      "shift+enter"
      "alt+enter"
    ];
    "app.message.followUp" = [ "shift+alt+enter" ];
  };
  piWebSearchConfig = {
    provider = "exa";
    workflow = "none";
    allowBrowserCookies = false;
    youtube.enabled = false;
    video.enabled = false;
  };

  installPiActivation = ''
    export PATH="${pkgs.nodejs_24}/bin:$PATH"
    export npm_config_prefix="${home}/.npm-global"
    npm_bin="$npm_config_prefix/bin"
    mkdir -p "$npm_bin"

    npm i -g --no-audit --no-fund @earendil-works/pi-coding-agent env-cmd beautiful-mermaid || true

    settings="${home}/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings")"
    pi_packages_json='${builtins.toJSON piPackages}'
    pi_npm_command_json='${builtins.toJSON piNpmCommand}'
    if [ -f "$settings" ]; then
      ${pkgs.jq}/bin/jq --argjson packages "$pi_packages_json" --argjson npmCommand "$pi_npm_command_json" '.packages = $packages | .npmCommand = $npmCommand' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
    else
      ${pkgs.jq}/bin/jq -n --argjson packages "$pi_packages_json" --argjson npmCommand "$pi_npm_command_json" '{packages: $packages, npmCommand: $npmCommand}' > "$settings"
    fi

    "$npm_bin/pi" update --extensions || true

    subagents_roots="${home}/.npm-global/lib/node_modules/pi-subagents ${home}/.pi/agent/npm/node_modules/pi-subagents"
    for subagents_root in $subagents_roots; do
      [ -d "$subagents_root" ] || continue
      ${pkgs.python3}/bin/python3 ${./files/pi-subagents-patch.py} "$subagents_root"
      rm -rf "$subagents_root/node_modules/.cache/jiti"
    done

    permission_system_roots="${home}/.npm-global/lib/node_modules/pi-permission-system ${home}/.pi/agent/npm/node_modules/pi-permission-system"
    for permission_system_root in $permission_system_roots; do
      [ -d "$permission_system_root" ] || continue
      ${pkgs.python3}/bin/python3 ${./files/pi-permission-system-patch.py} "$permission_system_root"
      rm -rf "$permission_system_root/node_modules/.cache/jiti"
    done
  '';

  writePiSettings = ''
    pi_settings_tmp="$(mktemp)"
    ${pkgs.jq}/bin/jq . <<'EOF' > "$pi_settings_tmp"
    ${builtins.toJSON piSettings}
    EOF
    if [[ -f "$HOME/.pi/agent/settings.json" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1] | del(.permissionLevel, .permissionMode)' "$HOME/.pi/agent/settings.json" "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    else
      ${pkgs.jq}/bin/jq '. | del(.permissionLevel, .permissionMode)' "$pi_settings_tmp" > "$HOME/.pi/agent/settings.json.tmp"
    fi
    mv "$HOME/.pi/agent/settings.json.tmp" "$HOME/.pi/agent/settings.json"
    rm -f "$pi_settings_tmp"
  '';
in
{
  home.packages = [
    readonlyBashPkg
    pkgs.bash
  ] ++ piReadonlyBashTrustedPathPackages;

  home.activation.install-pi = lib.hm.dag.entryAfter [ "writeBoundary" ] installPiActivation;

  home.activation.writePiConfigs = lib.hm.dag.entryAfter [ "writeBoundary" "install-pi" ] ''
    mkdir -p "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/extensions/pi-permission-system" "$HOME/.pi/agent/extensions/subagent" "$HOME/.pi/agent/readonly-bash-approvals"
    chmod 700 "$HOME/.pi/agent/readonly-bash-approvals"
    rm -f "$HOME/.pi/agent/extensions/readonly-bash-classifier.js"
    ${helpers.writeJson "$HOME/.pi/agent/readonly-bash.json" readonlyBashConfig}
    ${writePiSettings}
    ${helpers.writeJson "$HOME/.pi/agent/pi-permissions.jsonc" piPermissionPolicy}
    ${helpers.writeJson "$HOME/.pi/agent/extensions/pi-permission-system/config.json" piPermissionSystemConfig}
    ${helpers.writeJson "$HOME/.pi/agent/extensions/subagent/config.json" piSubagentsConfig}
    ${helpers.copyFile "$HOME/.pi/agent/extensions/chutes-provider.ts" ./files/chutes-provider.ts}
    ${helpers.writeJson "$HOME/.pi/agent/keybindings.json" piKeybindings}
    ${helpers.writeJson "$HOME/.pi/web-search.json" piWebSearchConfig}
  '';
}
