{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
let
  home = config.home.homeDirectory;
  discardContext = builtins.unsafeDiscardStringContext;
  helpers = import ./helpers.nix { inherit pkgs; };

  readonlyBashSrc = inputs.readonly-bash;
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
  piReadonlyBashTrustedPathString = discardContext (
    lib.makeBinPath piReadonlyBashTrustedPathPackages
  );

  npmInstallFlags = [
    "--no-audit"
    "--no-fund"
  ];
  piNpmCommand = [ "npm" ] ++ npmInstallFlags;
  piGlobalNpmPackages = [
    "@earendil-works/pi-coding-agent"
    "env-cmd"
    "beautiful-mermaid"
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
    "npm:pi-ffmpeg"
    "npm:@ygncode/pi-web@beta"
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
  piSubagentsConfig = {
    asyncByDefault = true;
    forceTopLevelAsync = true;
    intercomBridge.mode = "always";
  };
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

  patchPiPackage =
    packageName: patchScript:
    let
      packageRoots = [
        "${home}/.npm-global/lib/node_modules/${packageName}"
        "${home}/.pi/agent/npm/node_modules/${packageName}"
      ];
    in
    ''
      for package_root in ${lib.escapeShellArgs packageRoots}; do
        [ -d "$package_root" ] || continue
        ${pkgs.python3}/bin/python3 ${patchScript} "$package_root"
        rm -rf "$package_root/node_modules/.cache/jiti"
      done
    '';

  writePiSettings = ''
    settings="${home}/.pi/agent/settings.json"
    settings_tmp="$(mktemp)"
    mkdir -p "$(dirname "$settings")"
    ${pkgs.jq}/bin/jq . <<'EOF' > "$settings_tmp"
    ${builtins.toJSON piSettings}
    EOF
    if [[ -f "$settings" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1] | del(.permissionLevel, .permissionMode)' "$settings" "$settings_tmp" > "$settings.tmp"
    else
      ${pkgs.jq}/bin/jq '. | del(.permissionLevel, .permissionMode)' "$settings_tmp" > "$settings.tmp"
    fi
    mv "$settings.tmp" "$settings"
    rm -f "$settings_tmp"
  '';

  installPiActivation = ''
    export PATH="${pkgs.nodejs_24}/bin:$PATH"
    export npm_config_prefix="${home}/.npm-global"
    npm_bin="$npm_config_prefix/bin"
    mkdir -p "$npm_bin"

    npm install --global ${lib.escapeShellArgs (npmInstallFlags ++ piGlobalNpmPackages)}
    ${writePiSettings}
    "$npm_bin/pi" update --extensions

    ${patchPiPackage "pi-subagents" ./files/pi-subagents-patch.py}
    ${patchPiPackage "pi-permission-system" ./files/pi-permission-system-patch.py}
  '';
in
{
  home.packages = [
    readonlyBashPkg
    pkgs.bash
  ]
  ++ piReadonlyBashTrustedPathPackages;

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
