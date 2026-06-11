# AI harness config

This directory owns shared config for Claude Code, opencode, and Pi.

## Source of truth

- MCP servers live in `ai-harnesses/default.nix` as `mcpServers`.
- Shared skills live in `.claude/skills`; private skills stay in the `.claude/private-skills` submodule and are exposed through symlinks in `.claude/skills`.
- Provider login/auth is not synced here. Each harness keeps its own auth flow and credentials.
- `readonly-bash` core source lives outside dotfiles at `~/Documents/projects/readonly-bash`; dotfiles consume it as the locked `readonly-bash` flake input so `just update` refreshes it with nixpkgs.

## readonly-bash auto-approval

- Home Manager builds the generic Go core with Nix and writes the runtime config to `~/.pi/agent/readonly-bash.json`.
- Pi loads only `dotfiles/ai-harnesses/readonly-bash-classifier.js` through `settings.json`; activation removes any stale auto-discovered copy under `~/.pi/agent/extensions`.
- opencode loads a generated local plugin at `~/.config/opencode/plugins/readonly-bash.js`, copied from `dotfiles/ai-harnesses/readonly-bash-opencode-plugin.mjs`.
- Pi allows exactly the Nix-store `readonly-bash-runner` command. Unknown Pi bash stays on ask.
- opencode keeps bash commands unchanged in the transcript; its plugin auto-replies once to `permission.asked` only when `readonly-bash classify` marks every requested bash pattern read-only. Unknown opencode bash stays on ask.
- The wrappers only handle model `bash` tool calls. Pi's global `shellPath` and empty `shellCommandPrefix` settings still affect user `!` / `!!` shell execution.

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

## Dropped

- Claude Code Router config.
- Fish `mcp-on`, `mcp-off`, `mcp-list` helpers.
- The post-install patch that edited `permission-pi` package source.

## Audit portability

The flow audit entrypoint remains `.claude/skills/audit/SKILL.md` so Claude Code, opencode, and Pi all read the same instructions through the shared skills path.

- Claude Code uses `.claude/agents/reviewer.md` when available.
- opencode gets a generated `~/.config/opencode/agent/reviewer.md` subagent.
- Pi uses gotgenes subagents when useful, while flow audit can still fall back to the same inline review procedure when delegation is unavailable.

## Adding another harness

Add a renderer in `ai-harnesses/default.nix` that consumes the shared `mcpServers` attrset and `.claude/skills` path. Keep provider/model auth separate unless the harness explicitly supports portable config.
