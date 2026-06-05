{
  pkgs,
  lib,
  config,
  ...
}:
let
  mcpData = import ./mcp-servers.nix { inherit lib config; };

  opencodeEnabled = {
    bestiary = true;
    github = true;
    cloudsql-reader = true;
    arxiv = true;
  };
  opencodeMcpServer =
    name: v:
    if v ? url then
      {
        type = "remote";
        url = v.url;
        enabled = opencodeEnabled.${name} or false;
      }
      // lib.optionalAttrs (v ? headers) {
        headers = builtins.mapAttrs (_: lib.replaceStrings [ "\${" "}" ] [ "{env:" "}" ]) v.headers;
      }
    else
      {
        type = "local";
        command = [ v.command ] ++ (v.args or [ ]);
        enabled = opencodeEnabled.${name} or false;
      }
      // lib.optionalAttrs (v ? env) { environment = v.env; };

  mcpNames = builtins.attrNames mcpData.mcpServers;
  opencodeConfig = {
    "$schema" = "https://opencode.ai/config.json";
    permission = {
      "*" = "ask";
      bash = {
        "*" = "ask";
      };
      external_directory = "allow";
      websearch = "allow";
      glob = "allow";
      grep = "allow";
      list = "allow";
      lsp = "allow";
      read = "allow";
      task = "allow";
      todoread = "allow";
      todowrite = "allow";
      webfetch = "allow";
      skill = {
        "*" = "allow";
      };
    }
    // builtins.listToAttrs (
      map (name: {
        name = "${name}_*";
        value = "allow";
      }) mcpNames
    );
    provider.local-llm = {
      npm = "@ai-sdk/openai-compatible";
      name = "Local LLM";
      options = {
        baseURL = "http://100.64.0.1:6868/v1/";
        apiKey = "none";
      };
      models = {
        "qwen3.5-9b".name = "qwen3.5-9b";
        "gemma-4-26B-A4B".name = "gemma-4-26B-A4B";
      };
    };
    small_model = "github-copilot/gpt-5-mini";
    mcp = builtins.mapAttrs opencodeMcpServer mcpData.mcpServers;
  };
  opencodePackageJson = builtins.toJSON {
    private = true;
    type = "module";
    dependencies = {
      "@opencode-ai/plugin" = "latest";
    };
  };

  opencodeAgentReviewer = ''
    ---
    description: Independent fresh-context reviewer for flow tasks. Use for /audit-style reviews of ~/.flow/<slug>/PLAN.md against git diff; writes ~/.flow/<slug>/REVIEW.md with drift, bugs, bloat, missing items, and verdict.
    mode: subagent
    permission:
      edit: deny
      webfetch: deny
      task: deny
      todowrite: deny
      websearch: deny
      lsp: deny
      skill: deny
    ---
    You are an independent reviewer for the flow system. You have no prior context on this work. Your only inputs are the plan and actual diffs you read yourself. Be skeptical. Be specific. Cite file:line.

    Read PLAN.md fully, then run `git diff HEAD` in each touched repo. Cross-check every diff hunk against PLAN.md, every PLAN Changes line against the diff, and every PLAN edge case against real changed lines. Look for bugs, missed cases, bloat, out-of-scope changes, defensive code, backwards-compat shims, and mode-budget violations.

    Write `~/.flow/<slug>/REVIEW.md` with exactly:
    # Audit: <slug>
    Mode: <patch | clean | refactor>
    Repos: <repo1>, <repo2>, ...

    ## Plan-build drift
    Concrete deviations, or "None."

    ## Bugs
    Logic errors/missed edge cases with file:line, or "None."

    ## Bloat
    Untraceable or rule-violating hunks with file:line, or "None."

    ## Missing
    PLAN changes/edge cases with no diff support, or "None."

    ## Mode-specific
    Active-mode budget/new-file/justification checks, or "None."

    ## Verdict
    SHIP / NEEDS-FIXES / RE-PLAN, with one sentence why.

    End with: REVIEW.md written. Verdict: <SHIP | NEEDS-FIXES | RE-PLAN>.
  '';
in
{
  home.activation.writeOpencodeConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/opencode" "$HOME/.config/opencode/agent" "$HOME/.config/opencode/plugins"
    rm -f "$HOME/.config/opencode/opencode.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/opencode/opencode.json"
    ${builtins.toJSON opencodeConfig}
    EOF
    rm -f "$HOME/.config/opencode/package.json"; ${pkgs.jq}/bin/jq . <<'EOF' > "$HOME/.config/opencode/package.json"
    ${opencodePackageJson}
    EOF
    rm -f "$HOME/.config/opencode/plugins/readonly-bash.js"; cp "$HOME/dotfiles/ai-harnesses/readonly-bash-opencode-plugin.mjs" "$HOME/.config/opencode/plugins/readonly-bash.js"
    rm -f "$HOME/.config/opencode/agent/reviewer.md"; cat <<'EOF' > "$HOME/.config/opencode/agent/reviewer.md"
    ${opencodeAgentReviewer}
    EOF
  '';
}
