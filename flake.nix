{
  description = "Shared AI harness config for Claude Code, Codex, Gemini CLI, opencode, Pi, and MCP.";

  inputs = {
    readonly-bash = {
      url = "github:blackhat-7/readonly-bash/main";
      flake = false;
    };
  };

  outputs =
    inputs@{ self, ... }:
    {
      homeManagerModules.default =
        { ... }:
        {
          _module.args.aiHarnessesInputs = inputs;
          imports = [ ./default.nix ];
        };

      homeManagerModules.ai-harnesses = self.homeManagerModules.default;
    };
}
