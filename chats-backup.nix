{ config, pkgs, lib, ... }:
let
  # The global gitleaks rules, minus false positives that would wipe useful data
  # from the chats: the Sourcegraph rule flags every commit hash, and the generic
  # rule flags IDs (UUIDs such as profile keys) and dated names like
  # `interleaved-thinking-2025-05-14`.
  gitleaksConfig = pkgs.writeText "ai-chats-gitleaks.toml" ''
    [extend]
    path = "${config.home.homeDirectory}/.config/gitleaks/config.toml"
    disabledRules = [ "sourcegraph-access-token" ]

    [[allowlists]]
    targetRules = [ "generic-api-key" ]
    regexTarget = "secret"
    regexes = [
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      "^[a-z]+(-[a-z]+)*-[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    ]
  '';
  backup = pkgs.writeShellApplication {
    name = "ai-chats-backup";
    runtimeInputs = with pkgs; [ coreutils findutils git gitleaks jq openssh python3 rsync sqlite ];
    runtimeEnv.GITLEAKS_CONFIG = gitleaksConfig;
    text = builtins.readFile ./scripts/ai-chats-backup.sh;
  };
in
{
  home.packages = [ backup ];

  launchd.agents.ai-chats-backup = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    enable = true;
    config = {
      ProgramArguments = [ "${backup}/bin/ai-chats-backup" ];
      StartInterval = 1800;
      RunAtLoad = true;
      StandardOutPath = "${config.home.homeDirectory}/Library/Logs/ai-chats-backup.log";
      StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/ai-chats-backup.log";
    };
  };

  systemd.user = lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
    services.ai-chats-backup = {
      Unit.Description = "Back up AI chat transcripts to git";
      Service = {
        Type = "oneshot";
        ExecStart = "${backup}/bin/ai-chats-backup";
      };
    };
    timers.ai-chats-backup = {
      Unit.Description = "Back up AI chat transcripts every 30 minutes";
      Timer = {
        OnCalendar = "*:0/30";
        Persistent = true;
      };
      Install.WantedBy = [ "timers.target" ];
    };
  };
}
