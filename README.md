# ai-harnesses

Shared Home Manager config for Claude Code, opencode, Pi, and MCP catalogs.

Keep this repo focused on portable harness config, not machine-specific system
configuration.

## Usage

As a flake input:

```nix
inputs.ai-harnesses.url = "github:blackhat-7/ai-harnesses/main";
# Optional if the parent flake already pins readonly-bash:
inputs.ai-harnesses.inputs.readonly-bash.follows = "readonly-bash";
```

Then import the Home Manager module:

```nix
inputs.ai-harnesses.homeManagerModules.default
```

Optional mode selection:

```nix
aiHarnesses.mode = "restricted"; # default: ask for writes/unknown bash
# aiHarnesses.mode = "yolo";     # container/sandbox use: allow broadly
```

For local development, keep the committed input on GitHub and override it from
the command line when needed:

```bash
nix build .#homeConfigurations.<name>.activationPackage \
  --override-input ai-harnesses path:/path/to/ai-harnesses
```

## Source of truth

- MCP servers live in `mcp-servers.nix`.
- Claude Code config lives in `claude.nix`.
- opencode config lives in `opencode.nix`.
- Pi config lives in `pi.nix`.
- Provider login/auth is not synced here. Each harness keeps its own auth flow and credentials.
- Remote MCP API keys are referenced through environment variables such as `GITHUB_MCP_TOKEN` and `AFTERSHOOT_MCP_API_KEY`.
- `readonly-bash` is consumed as a flake input and exposed to Pi/opencode wrappers.

## readonly-bash auto-approval

- Home Manager builds the generic Go core with Nix and writes the runtime config to `~/.pi/agent/readonly-bash.json`.
- Pi loads this repo's `readonly-bash-classifier.js` through `settings.json`; activation removes any stale auto-discovered copy under `~/.pi/agent/extensions`.
- opencode loads a generated local plugin at `~/.config/opencode/plugins/readonly-bash.js`, copied from `readonly-bash-opencode-plugin.mjs`.
- Pi allows exactly the Nix-store `readonly-bash-runner` command. Unknown Pi bash stays on ask.
- opencode keeps bash commands unchanged in the transcript; its plugin auto-replies once to `permission.asked` only when `readonly-bash classify` marks every requested bash pattern read-only. Unknown opencode bash stays on ask.

## Generated files

Home Manager writes:

- `~/.claude/settings.json`
- `~/.claude.json`
- `~/.config/opencode/opencode.json`
- `~/.config/opencode/package.json`
- `~/.config/opencode/plugins/readonly-bash.js`
- `~/.config/opencode/agent/reviewer.md`
- `~/.pi/agent/settings.json`
- `~/.pi/agent/readonly-bash.json`
- `~/.pi/agent/extensions/pi-permission-system/config.json`
- `~/.pi/agent/subagents.json`
- `~/.pi/agent/keybindings.json`
- `~/.pi/web-search.json`
- `~/.config/mcp/mcp.json`
- `~/.config/mcp/mcp.catalog.json`

Manual edits to those generated files are not the source of truth.

## Pi subagents

- Pi uses `@gotgenes/pi-subagents` plus `@gotgenes/pi-permission-system` for Claude Code/opencode-style live subagent visibility, steering, graceful turn limits, and native forwarded permission prompts.
- Home Manager does not patch either package after install; the previous legacy `pi-subagents`/`pi-permission-system` forwarding patches are intentionally dropped in favor of the native gotgenes integration.

## Adding another harness

Add a renderer module that consumes the shared `mcpServers` attrset from
`mcp-servers.nix` and the shared `.claude/skills` path. Keep provider/model auth
separate unless the harness explicitly supports portable config.
