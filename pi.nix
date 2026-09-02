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
  mode = config.aiHarnesses.mode or "restricted";
  selectedMcpServers = config.aiHarnesses.mcp.enabledServers or null;
  mcpEnabled = (config.aiHarnesses.mcp.enable or true) && selectedMcpServers != [ ];
  disabledPiPackages = config.aiHarnesses.pi.disabledPackages or [ ];
  piPackageEnabled = source: !builtins.elem source disabledPiPackages;
  piPermissionSystemEnabled = mode == "restricted" && piPackageEnabled "npm:@gotgenes/pi-permission-system";
  piAutomodeEnabled = mode == "auto" && piPackageEnabled "npm:@czottmann/pi-automode";

  readonlyBashSrc = aiHarnessesInputs.readonly-bash;
  readonlyBashPkg = pkgs.callPackage "${readonlyBashSrc}/package.nix" {
    defaultConfigPath = "~/.pi/agent/readonly-bash.json";
  };

  readonlyBashCliString = discardContext "${readonlyBashPkg}/bin/readonly-bash";
  readonlyBashRunnerCommandString = discardContext "${readonlyBashPkg}/bin/readonly-bash-runner";
  readonlyBashSandbox = pkgs.writeShellApplication {
    name = "readonly-bash-sandbox";
    runtimeInputs = [ pkgs.which pkgs.ripgrep ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.bubblewrap pkgs.socat ];
    text = ''
      exec ${pkgs.nodejs}/bin/node ${./readonly-bash-sandbox.mjs} \
        ${pkgs.sandbox-runtime}/lib/node_modules/@anthropic-ai/sandbox-runtime/dist/index.js "$@"
    '';
  };
  readonlyBashSandboxString = discardContext "${readonlyBashSandbox}/bin/readonly-bash-sandbox";
  piReadonlyBashTrustedShellString = discardContext "${pkgs.bash}/bin/bash";
  piReadonlyBashTrustedPathPackages = [
    pkgs.bash
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.ripgrep
    pkgs.git
    pkgs.file
    pkgs.gnused
    pkgs.gawk
    pkgs.go
    pkgs.stdenv.cc
    pkgs.nodejs
    pkgs.python3
    pkgs.python3Packages.pytest
    pkgs.ruff
    pkgs.nix
    pkgs.nixfmt
    pkgs.shellcheck
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
  ] ++ lib.optionals (piPackageEnabled "npm:pi-lean-ctx") [ "lean-ctx-bin" ];
  piPackages = builtins.filter piPackageEnabled (
    lib.optionals mcpEnabled [ "npm:pi-mcp-adapter" ]
    ++ lib.optionals piPermissionSystemEnabled [ "npm:@gotgenes/pi-permission-system" ]
    ++ lib.optionals piAutomodeEnabled [ "npm:@czottmann/pi-automode" ]
    ++ [
      "npm:pi-web-access"
      "npm:@gotgenes/pi-subagents"
      "npm:pi-mermaid"
      "npm:@juicesharp/rpiv-todo"
      "npm:@ifi/oh-pi-themes"
      "npm:pi-opencode-theme"
      "npm:pi-rewind"
      "npm:pi-intercom"
      "npm:pi-autoname"
      "npm:pi-session-move"
      "npm:pi-bar"
      "npm:pi-claude-style-tools"
      "npm:pi-hermes-memory"
      "npm:@codexstar/pi-listen"
      "npm:pi-lean-ctx"
      "git:github.com/DietrichGebert/ponytail"
    ]
  );

  readonlyBashConfig = {
    cliPath = readonlyBashCliString;
    runnerPath = readonlyBashRunnerCommandString;
    approvalDir = "~/.pi/agent/readonly-bash-approvals";
    trustedShell = piReadonlyBashTrustedShellString;
    trustedPath = piReadonlyBashTrustedPathString;
    sandboxPath = readonlyBashSandboxString;
    sandboxSettingsPath = "~/.pi/agent/readonly-bash-sandbox.json";
    allowNetworkRead = true;
    allowTrustedExecute = true;
    globalSettingsPath = "~/.pi/agent/settings.json";
    projectSettingsLookup = "cwd";
  };

  readonlyBashSandboxConfig = {
    filesystem = {
      denyRead = [ "~" ".env" ];
      allowRead = [ "." ];
      allowWrite = [ "." "/tmp" ] ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ "/private/tmp" ];
      denyWrite = [ ".git" ".env" ];
    };
  } // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
    enableWeakerNetworkIsolation = true;
  };

  piSettings = {
    packages = piPackages;
    npmCommand = piNpmCommand;
    skills = [ "~/.claude/skills" ];
    prompts = [ "~/.claude/commands" ];
    extensions = [
      "${./readonly-bash-classifier.js}"
      "${./patches/pi-mouse.js}"
      "${./patches/local-model-provider.ts}"
    ] ++ lib.optionals piPermissionSystemEnabled [
      "${./patches/pi-permission-dialog-queue.js}"
    ];
    shellPath = piReadonlyBashTrustedShellString;
    shellCommandPrefix = "";
    defaultProvider = "openai-codex";
    enabledModels = [
      "openai-codex/*"
      "deepseek/*"
      "anthropic/*"
      "kimi-coding/*"
      "local-models/*"
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
  piAutomodeConfig.autoMode = {
    classifierModel = "openai-codex/gpt-5.6-sol";
    classifierReasoningLevel = "low";
    allowInsideWorkingDirectory = true;
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
    ctx_read = "allow";
    ctx_grep = "allow";
    ctx_find = "allow";
    ctx_ls = "allow";
    ctx_tree = "allow";
    ctx_compose = "allow";
    ctx_expand = "allow";
    ctx_glob = "allow";
    ctx_search = "allow";
    ctx_callgraph = "allow";
    memory = "allow";
    memory_add = "allow";
    memory_search = "allow";
    session_search = "allow";
    todo = "allow";
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
    mcpScript = "allow";
    "mcp__*" = "allow";
  };
  piPermissionSystemConfig = {
    debugLog = false;
    permissionReviewLog = true;
    permission = piRestrictedPermission;
  };
  piLeanCtxConfig = {
    mode = "additive";
    routeShell = false;
    enableMcp = true;
    toolProfile = "lean";
    disableTools = [
      "ctx_patch"
      "ctx_shell"
      "shell"
    ];
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

  writePiLeanCtxConfig = lib.optionalString (piPackageEnabled "npm:pi-lean-ctx") ''
    ${helpers.writeJson "$HOME/.pi/agent/extensions/pi-lean-ctx/config.json" piLeanCtxConfig}
  '';
  writePiPermissionSystemConfig = lib.optionalString piPermissionSystemEnabled ''
    ${helpers.writeJson "$HOME/.pi/agent/extensions/pi-permission-system/config.json" piPermissionSystemConfig}
  '';
  writePiAutomodeConfig = lib.optionalString piAutomodeEnabled ''
    mkdir -p "$HOME/.pi/agent/extensions/pi-automode"
    ${helpers.writeJson "$HOME/.pi/agent/extensions/pi-automode/config.json" piAutomodeConfig}
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
    readonlyBashSandbox
    pkgs.bash
  ]
  ++ piReadonlyBashTrustedPathPackages;

  home.activation.install-pi = lib.hm.dag.entryAfter [ "writeBoundary" ] installPiActivation;

  home.activation.writePiConfigs = lib.hm.dag.entryAfter [ "writeBoundary" "install-pi" ] ''
    mkdir -p "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/extensions/pi-lean-ctx" "$HOME/.pi/agent/extensions/pi-permission-system" "$HOME/.pi/agent/readonly-bash-approvals"
    chmod 700 "$HOME/.pi/agent/readonly-bash-approvals"
    rm -f "$HOME/.pi/agent/extensions/readonly-bash-classifier.js" "$HOME/.pi/agent/pi-permissions.jsonc" "$HOME/.pi/agent/extensions/subagent/config.json"
    ${helpers.writeJson "$HOME/.pi/agent/readonly-bash.json" readonlyBashConfig}
    ${helpers.writeJson "$HOME/.pi/agent/readonly-bash-sandbox.json" readonlyBashSandboxConfig}
    ${writePiSettings}
    ${writePiClaudeStyleToolsSettings}
    ${writePiPermissionSystemConfig}
    ${writePiLeanCtxConfig}
    ${writePiAutomodeConfig}
    ${helpers.writeJson "$HOME/.pi/agent/subagents.json" piSubagentsSettings}
    rm -f "$HOME/.pi/agent/models.json"
    ${patchPiClaudeStyleTools}
    ${helpers.copyFile "$HOME/.pi/agent/extensions/chutes-provider.ts" ./patches/chutes-provider.ts}
    ${helpers.writeJson "$HOME/.pi/agent/keybindings.json" piKeybindings}
    ${helpers.writeJson "$HOME/.pi/web-search.json" piWebSearchConfig}
  '';
}
