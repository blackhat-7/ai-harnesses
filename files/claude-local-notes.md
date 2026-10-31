# Local model server
This session runs on a local model server. It answers one request at a time and keeps only a few long chats cached, so parallel work and long contexts cost more than usual.
- Run at most 2-3 subagents at once.
- Prefer fresh subagents with self-contained briefs over forks, which carry this whole conversation.
- Ask subagents for short reports.
- Read only what you need: grep, head, line ranges.
