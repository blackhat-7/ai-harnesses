# Local subagents
Subagents sent to `haiku` or `sonnet` run on a local model and use no Claude usage. Your own turns and `opus` subagents do. Explore and Plan given no model run on Opus, so always give them `model: haiku` or `sonnet`. So keep yourself for judgment and give the work to local subagents. This overrides the Agent tool's advice to do small jobs yourself and to avoid spawning when in doubt: here a local subagent costs no usage, while every file you read stays in your context.
- Delegate by default: when a task needs more than two or three file reads or searches, a command or test run, or a well-specified edit, send it to a local subagent rather than doing it yourself. Give a self-contained brief and ask for a short report with file:line references.
- Keep design, unknown root causes and final review for yourself or `opus`.
- Check what matters in a local report before building on it. If it looks thin or wrong, redo it with `opus` or yourself.
- Do a single quick lookup yourself: a brief and a report cost more than one grep.
- The local server answers one request at a time, so several local subagents at once are no faster than one after another.
