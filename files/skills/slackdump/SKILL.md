# slackdump — read-only Slack workspace access

Read-only access to Slack messages, channels, users, and stats, from a local
slackdump archive. No admin privileges, no bot app, no writes.

## When to Use

Use whenever the user asks anything about Slack messages, channels, activity,
or stats. Everything below is strictly read-only: the MCP server never
modifies the archive, and the archive itself is opened `mode=ro`.

## Tools

- **slackdump MCP server** (`slackdump mcp <archive>`, stdio): raw access.
  - `get_messages(channel_id, limit=100, after_ts)` — paginate with `after_ts`.
  - `get_thread(channel_id, thread_ts)` — replies to a parent message.
  - `list_channels`, `get_channel(channel_id)`, `list_users`, `get_workspace_info`.
  - `load_source(path)` — switch archives at runtime.
- **bestiary `slack_stats` tool** — preferred for stats and aggregates (SQL
  over the archive): ops `channels`, `users`, `messages_per_day`, `top_users`,
  `search`. Params: `channel` (Slack ID), `days` (default 30, max 3650),
  `limit` (default 20, max 100), `query` (required for `search`).

## Data freshness — do not run these yourself

- Archive: `~/.slack-archive/slackdump.sqlite`.
- Refresh: a launchd agent runs `slackdump resume ~/.slack-archive` daily
  (incremental). If data looks stale, mention it to the user — do not run
  archive/resume yourself, and never start a full `slackdump archive` (a huge
  operation) without the user asking.
- Auth: one-time `slackdump workspace new` (browser login). Sessions expire
  after months; if calls return auth errors, ask the user to re-login.

## Pitfalls

- Coverage is only what the user's account can see: public channels, private
  channels they belong to, their own DMs.
- Channel IDs look like `C0123ABCD`; map names→IDs with `list_channels`.
- Message text is in `TXT`; full metadata (user, bot_id, reactions) is in the
  `DATA` JSON blob — the slack_stats tool reads user IDs from there.
- Resumed archives can contain duplicate rows across chunks; slack_stats
  counts distinct (id, channel) pairs. Run `slackdump tools dedupe` if ever
  needed (ops task, not agent task).
