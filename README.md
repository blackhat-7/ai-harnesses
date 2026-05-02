# AI harness config

This directory owns shared config for Claude Code, opencode, and Pi.

## Source of truth

- MCP servers live in `ai-harnesses/default.nix` as `mcpServers`.
- Shared skills live in `.claude/skills`; private skills stay in the `.claude/private-skills` submodule and are exposed through symlinks in `.claude/skills`.
- Provider login/auth is not synced here. Each harness keeps its own auth flow and credentials.

## Generated files

Home Manager writes:

- `~/.claude/settings.json`
- `~/.claude.json`
- `~/.config/opencode/opencode.json`
- `~/.config/opencode/package.json`
- `~/.config/opencode/agent/reviewer.md`
- `~/.pi/agent/settings.json`
- `~/.pi/agent/keybindings.json`
- `~/.config/mcp/mcp.json`
- `~/.config/mcp/mcp.catalog.json`

Manual edits to those generated files are not the source of truth.

## Dropped

- Claude Code Router config.
- Fish `mcp-on`, `mcp-off`, `mcp-list` helpers.
- The post-install patch that edited `permission-pi` package source. `permission-pi` itself remains installed.

## Audit portability

The flow audit entrypoint remains `.claude/skills/audit/SKILL.md` so Claude Code, opencode, and Pi all read the same instructions through the shared skills path.

- Claude Code uses `.claude/agents/reviewer.md` when available.
- opencode gets a generated `~/.config/opencode/agent/reviewer.md` subagent.
- Pi has no subagents, so the audit skill uses the same review procedure inline and records that in `REVIEW.md`.

## Adding another harness

Add a renderer in `ai-harnesses/default.nix` that consumes the shared `mcpServers` attrset and `.claude/skills` path. Keep provider/model auth separate unless the harness explicitly supports portable config.
