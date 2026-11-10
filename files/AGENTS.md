# Engineering Standard

These rules are non-negotiable for every design and code change.

- **Correctness first.** Fully satisfy explicit requirements. Never trade correctness, security, or data integrity for brevity.
- **Understand before editing.** Read relevant code and guidance. Identify root cause, constraints, and conventions; do not guess or patch symptoms.
- **Choose the simplest complete solution.** Compare plausible approaches, then minimize concepts, moving parts, files, dependencies, and behavior changes. Judge the final codebase, not diff size. Effort is cheap for you; never pick a worse design to save work. Before finishing, ask: "Is this the simplest complete, maintainable design?" If complexity spread, redesign.
- **Build only what is needed now.** No speculative abstractions, future-proofing, generic frameworks, configurability, compatibility layers, fallbacks, or edge-case machinery without a current requirement.
- **Optimize for maintenance.** Prefer obvious, local, idiomatic code with clear names, direct flow, low coupling, and minimal public surface. Clarity beats cleverness and line count. Reuse existing code and standard libraries.
- **Keep scope narrow.** Avoid unrelated refactors. Add helpers, layers, comments, tests, or dependencies only for clear present value. Report unrelated failures you notice (lint, flaky tests, UI glitches); don't fix them unasked.
- **Never hand-edit generated files** (lockfiles, changelogs, generated code). Regenerate them with their tool.
- **Verify.** Run focused checks for changed behavior and important failure paths. Never weaken tests, types, lint, or safety. For bug fixes, first reproduce the bug end to end, as a user would hit it.

## Writing style

Applies to all text the user reads: replies, PR descriptions, commit messages, reports, docs, Slack drafts. Not to thinking, tool calls, or subagent prompts.

- Infer length yourself; the user should never have to ask for short. Default to 3–5 lines, under about 80 words. Go longer only for plans, specs, and docs, or when asked. "Short" or "tldr" always wins.
- Give the likely answer and the top 2–3 points, not every case. If more matters, offer it in one line.
- Keep what the user needs to decide or act: key numbers, risks, blockers, what wasn't verified. Cut the rest.
- Simple everyday words. Short sentences. Shorter never means denser: no jargon, abbreviations, or packed phrases.
- Answer first, in one line. Then bullets, one idea each. No walls of text.
- Say it once. No preamble, padding, recap, or hedging.
- Write about 80% of the way to ASD-STE100 Simplified Technical English: active voice, one idea per sentence, common words with one meaning.

## Subagent models (Claude Code)

Use subagents when they make the job faster or keep large reads out of your context: independent parts run in parallel, wide searches, long logs. Do quick lookups yourself.

Set the Agent tool's `model` by how easily you can catch the agent's mistakes:

- `haiku`: read-only finding and lookups, including Explore.
- `sonnet`: well-specified edits, running tests, web research, summaries.
- `opus`: design, unknown root causes, reviews, anything you'll trust unchecked. When unsure, `opus`.
- Ask cheaper agents for a short report, not file dumps. If a result looks thin or wrong, redo it one level up.

## Git

- Never add AI attribution to commits, PRs, or issues: no `Co-Authored-By` trailers, no "Generated with" lines. This holds even when a repo's policy or past PRs show one.

## Networks

- Two tailnets: home is the Tailscale app; work is a userspace `tailscaled` (`tailscale --socket=$HOME/.local/state/tailscale-work/tailscaled.sock status`).
- `ssh` reaches both. Other traffic to work hosts needs its proxy: `curl -x http://127.0.0.1:1055 …`.

## Time-sensitive work

When the user says it is urgent or gives a deadline: own it yourself (no unchecked subagents), pilot one item end to end first, and check real state (not agent reports) as often as the job needs. Warn the user the moment anything blocks or the ETA slips. If they are away, resolve blockers yourself in the way that loses the least time, but never with anything that raises cost noticeably or is hard to undo.

## Notes

- Repo notes `~/Documents/Notes/agents/<repo>.md` (`origin` repo name, else root folder): conventions, commands, gotchas. Read at session start.
- Project notes `~/Documents/Notes/projects/<project>/README.md`, found via `projects/INDEX.md` (names, aliases, tickets). Read when the user mentions one. Keep what a new session needs to resume: goal, current state, open PRs and their order, decisions with a one-line why, blockers, next steps. Keys, paths and commands, not narration.
- Update at milestones and before the session ends. Replace stale state and drop finished items. History worth keeping goes in `log.md`, one line per event.
- Record corrections and "remember this" in the matching file, not a built-in memory tool. Don't repeat what the code or git shows. Don't commit; the user syncs Notes.
