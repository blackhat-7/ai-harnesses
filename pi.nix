{
  pkgs,
  lib,
  config,
  inputs ? { },
  aiHarnessesInputs ? inputs,
  ...
}:
let
  discardContext = builtins.unsafeDiscardStringContext;
  helpers = import ./helpers.nix { inherit pkgs; };
  isYolo = (config.aiHarnesses.mode or "restricted") == "yolo";
  selectedMcpServers = config.aiHarnesses.mcp.enabledServers or null;
  mcpEnabled = (config.aiHarnesses.mcp.enable or true) && selectedMcpServers != [ ];
  disabledPiPackages = config.aiHarnesses.pi.disabledPackages or [ ];
  piPackageEnabled = source: !builtins.elem source disabledPiPackages;

  readonlyBashSrc = aiHarnessesInputs.readonly-bash;
  readonlyBashPkg = pkgs.callPackage "${readonlyBashSrc}/package.nix" {
    defaultConfigPath = "~/.pi/agent/readonly-bash.json";
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
    "beautiful-mermaid"
  ];
  piPackages = builtins.filter piPackageEnabled (
    lib.optionals mcpEnabled [ "npm:pi-mcp-adapter" ] ++ [
      "npm:@gotgenes/pi-permission-system"
      "npm:pi-web-access"
      "npm:@gotgenes/pi-subagents"
      "npm:pi-mermaid"
      "npm:@juicesharp/rpiv-todo"
      "npm:@ifi/oh-pi-themes"
      "npm:pi-opencode-theme"
      "npm:pi-rewind"
      "npm:pi-intercom"
      "npm:pi-autoname"
      "npm:pi-bar"
      "npm:pi-ffmpeg"
      "npm:pi-claude-style-tools"
      "git:github.com/blackhat-7/pi-dynamic-workflows@permission-prompts"
      "npm:pi-vim"
      "npm:pi-hermes-memory"
      "npm:@codexstar/pi-listen"
    ]
  );

  readonlyBashConfig = {
    cliPath = readonlyBashCliString;
    runnerPath = readonlyBashRunnerCommandString;
    approvalDir = "~/.pi/agent/readonly-bash-approvals";
    trustedShell = piReadonlyBashTrustedShellString;
    trustedPath = piReadonlyBashTrustedPathString;
    globalSettingsPath = "~/.pi/agent/settings.json";
    projectSettingsLookup = "cwd";
  };

  piSettings = {
    packages = piPackages;
    npmCommand = piNpmCommand;
    skills = [ "~/.claude/skills" ];
    prompts = [ "~/.claude/commands" ];
    extensions = [
      "${./readonly-bash-classifier.js}"
      "${./patches/pi-mouse.js}"
      "${./patches/pi-permission-dialog-queue.js}"
    ];
    shellPath = piReadonlyBashTrustedShellString;
    shellCommandPrefix = "";
    defaultProvider = "openai-codex";
    enabledModels = [
      "openai-codex/*"
      "chutes/**"
      "anthropic/*"
      "kimi-coding/*"
    ];
    compaction.enabled = true;
  } // lib.optionalAttrs (piPackageEnabled "npm:@codexstar/pi-listen") {
    voice = {
      version = 2;
      enabled = true;
      language = "en";
      backend = "local";
      localModel = "parakeet-v2";
      scope = "global";
      ttsEnabled = false;
      ttsBackend = "local";
      ttsLocalModel = "kokoro-en-v0_19";
      ttsLocalVoiceId = 0;
      ttsAutoSpeak = true;
      ttsLanguage = "en";
      ttsOnboardingShown = true;
      onboarding = {
        completed = true;
        schemaVersion = 2;
        source = "setup-command";
      };
    };
  };
  piClaudeStyleToolsSettings = {
    toolBackground = "transparent";
    groupToolCalls = true;
  };
  piYoloPermission = {
    "*" = "allow";
  };
  piRestrictedPermission = {
    "*" = "ask";
    skill = "allow";
    external_directory = "allow";
    bash = {
      "${readonlyBashRunnerCommandString}" = "allow";
      "READONLY_BASH_REQUEST_ID=* ${readonlyBashRunnerCommandString}" = "allow";
    };
    read = "allow";
    grep = "allow";
    find = "allow";
    ls = "allow";
    web_search = "allow";
    web_fetch = "allow";
    fetch_content = "allow";
    get_search_content = "allow";
    code_search = "allow";
    memory = "allow";
    memory_search = "allow";
    session_search = "allow";
    todo = "allow";
    workflow = "allow";
    structured_output = "allow";
    subagent = "allow";
    get_subagent_result = "allow";
    steer_subagent = "allow";
    intercom = "allow";
    contact_supervisor = "allow";
    write = "ask";
    edit = "ask";
  } // lib.optionalAttrs mcpEnabled {
    mcp = "allow";
  };
  piPermissionSystemConfig = {
    debugLog = false;
    permissionReviewLog = true;
    yoloMode = isYolo;
    permission = if isYolo then piYoloPermission else piRestrictedPermission;
  };
  piSubagentsSettings = {
    maxConcurrent = 4;
    defaultMaxTurns = 50;
    graceTurns = 5;
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

  writePiSettings = ''
    settings="$HOME/.pi/agent/settings.json"
    settings_tmp="$(mktemp)"
    mkdir -p "$(dirname "$settings")"
    ${pkgs.jq}/bin/jq . <<'EOF' > "$settings_tmp"
    ${builtins.toJSON piSettings}
    EOF
    if [[ -f "$settings" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1] | del(.permissionLevel, .permissionMode, .subagents)' "$settings" "$settings_tmp" > "$settings.tmp"
    else
      ${pkgs.jq}/bin/jq '. | del(.permissionLevel, .permissionMode, .subagents)' "$settings_tmp" > "$settings.tmp"
    fi
    mv "$settings.tmp" "$settings"
    rm -f "$settings_tmp"
  '';

  writePiClaudeStyleToolsSettings = lib.optionalString (piPackageEnabled "npm:pi-claude-style-tools") ''
    settings="$HOME/.pi/settings.json"
    settings_tmp="$(mktemp)"
    mkdir -p "$(dirname "$settings")"
    ${pkgs.jq}/bin/jq . <<'EOF' > "$settings_tmp"
    ${builtins.toJSON piClaudeStyleToolsSettings}
    EOF
    if [[ -f "$settings" ]]; then
      ${pkgs.jq}/bin/jq -s '.[0] * .[1]' "$settings" "$settings_tmp" > "$settings.tmp"
    else
      ${pkgs.jq}/bin/jq . "$settings_tmp" > "$settings.tmp"
    fi
    mv "$settings.tmp" "$settings"
    rm -f "$settings_tmp"
  '';
  patchPiClaudeStyleTools = lib.optionalString (piPackageEnabled "npm:pi-claude-style-tools") ''
    ${pkgs.nodejs_26}/bin/node ${./patches/patch-pi-claude-style-code-blocks.js}
  '';
  patchPiSubagents = lib.optionalString (piPackageEnabled "npm:@gotgenes/pi-subagents") ''
    ${pkgs.nodejs_26}/bin/node ${./patches/patch-pi-subagents-mouse.js}
    ${pkgs.nodejs_26}/bin/node ${./patches/patch-pi-subagents-inherit-model.js}
  '';
  patchPiListen = lib.optionalString (piPackageEnabled "npm:@codexstar/pi-listen") ''
    ${pkgs.nodejs_26}/bin/node ${./patches/patch-pi-listen-pauses.js}
  '';
  removeDisabledPiPackages = lib.concatMapStringsSep "\n" (source: ''
    if ${pkgs.jq}/bin/jq -e --arg source ${lib.escapeShellArg source} \
      'any(.packages[]?; (if type == "string" then . else .source end) == $source)' \
      "$HOME/.pi/agent/settings.json" >/dev/null 2>&1; then
      npm_config_legacy_peer_deps=true "$npm_bin/pi" remove ${lib.escapeShellArg source}
    fi
  '') disabledPiPackages;

  installPiActivation = ''
    export PATH="${lib.makeBinPath [ pkgs.nodejs_26 pkgs.curl pkgs.wget pkgs.git pkgs.git-lfs ]}:$PATH"
    export npm_config_prefix="$HOME/.npm-global"
    npm_bin="$npm_config_prefix/bin"
    mkdir -p "$npm_bin"

    npm install --global ${lib.escapeShellArgs (npmInstallFlags ++ piGlobalNpmPackages)}
    ${removeDisabledPiPackages}
    ${writePiSettings}
    ${writePiClaudeStyleToolsSettings}
    "$npm_bin/pi" update --extensions
    ${patchPiClaudeStyleTools}
    ${patchPiSubagents}
    ${patchPiListen}
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
    mkdir -p "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/extensions/pi-permission-system" "$HOME/.pi/agent/readonly-bash-approvals"
    chmod 700 "$HOME/.pi/agent/readonly-bash-approvals"
    rm -f "$HOME/.pi/agent/extensions/readonly-bash-classifier.js" "$HOME/.pi/agent/pi-permissions.jsonc" "$HOME/.pi/agent/extensions/subagent/config.json"
    ${helpers.writeJson "$HOME/.pi/agent/readonly-bash.json" readonlyBashConfig}
    ${writePiSettings}
    ${writePiClaudeStyleToolsSettings}
    ${helpers.writeJson "$HOME/.pi/agent/extensions/pi-permission-system/config.json" piPermissionSystemConfig}
    ${helpers.writeJson "$HOME/.pi/agent/subagents.json" piSubagentsSettings}
    ${patchPiClaudeStyleTools}
    ${helpers.copyFile "$HOME/.pi/agent/extensions/chutes-provider.ts" ./patches/chutes-provider.ts}
    ${helpers.writeJson "$HOME/.pi/agent/keybindings.json" piKeybindings}
    ${helpers.writeJson "$HOME/.pi/web-search.json" piWebSearchConfig}
  '';
}
