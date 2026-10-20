{ pkgs, lib, ... }:
let
  # Peekaboo.app is the Bridge host that holds the Screen Recording and
  # Accessibility grants. The MCP server runs under background launchd
  # daemons (Paseo), which can't hold TCC grants themselves, so it drives the
  # app over its socket. The CLI and app must come from the same release.
  version = "4.9.5";
  release = "https://github.com/openclaw/Peekaboo/releases/download/v${version}";
  peekaboo = pkgs.stdenvNoCC.mkDerivation {
    pname = "peekaboo";
    inherit version;
    srcs = [
      (pkgs.fetchurl {
        url = "${release}/Peekaboo-${version}.app.zip";
        hash = "sha256-0XYwGw70tpXBHL24wL27xx9H+Gb3bHNN2tg0OrX5Pjg=";
      })
      (pkgs.fetchurl {
        url = "${release}/peekaboo-macos-arm64.tar.gz";
        hash = "sha256-L0Ncc2RZo9MCeYNQOPx+ZwKIdb6Df0Z8h1IeoU2jqe4=";
      })
    ];
    nativeBuildInputs = [ pkgs.unzip ];
    sourceRoot = ".";
    # Fixup rewrites the signed binaries and breaks their code signatures.
    dontFixup = true;
    installPhase = ''
      mkdir -p $out/Applications $out/libexec $out/bin
      mv Peekaboo.app $out/Applications/
      mv peekaboo-macos-arm64 $out/libexec/peekaboo
      ln -s $out/libexec/peekaboo/peekaboo $out/bin/peekaboo
    '';
    meta.platforms = [ "aarch64-darwin" ];
  };
in
{
  config = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    home.packages = [ peekaboo ];

    # The CLI never launches the app, so keep it running from login.
    launchd.agents.peekaboo = {
      enable = true;
      config = {
        ProgramArguments = [
          "/usr/bin/open"
          "-a"
          "${peekaboo}/Applications/Peekaboo.app"
        ];
        RunAtLoad = true;
      };
    };
  };
}
