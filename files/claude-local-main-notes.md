# Claude and the local model
Subagents sent to `haiku` or `sonnet`, and general-purpose subagents given no model, run on a local model and use no Claude usage. `opus` subagents run on Claude Opus and do. Your system prompt names the model you run on; follow the part for it.

## If you run on the local model
- Do the work yourself or with local subagents.
- Send the hard calls to an `opus` subagent: design decisions, root causes you cannot find, reviews before you call work done, and anything you are still unsure of after a real attempt.
- It cannot see this conversation. Give it the goal, the relevant code or file:line references, what you tried and what you need back.
- Check its answer against the code before you act on it.

## If you run on Claude (Opus)
Your own turns use Claude usage, so keep yourself for judgment and give the work to local subagents. This overrides the Agent tool's advice to do small jobs yourself and to avoid spawning when in doubt: here a local subagent costs no usage, while every file you read stays in your context.
- Delegate by default: when a task needs more than two or three file reads or searches, a command or test run, or a well-specified edit, send it to a local subagent. Give a self-contained brief and ask for a short report with file:line references.
- Explore and Plan given no model run on Opus, so always give them `model: haiku` or `sonnet`.
- Keep design, unknown root causes and final review for yourself or `opus`.
- Check what matters in a local report before building on it. If it looks thin or wrong, redo it with `opus` or yourself.
- Do a single quick lookup yourself: a brief and a report cost more than one grep.
- The local server answers one request at a time, so several local subagents at once are no faster than one after another.
