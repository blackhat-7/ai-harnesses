#!/usr/bin/env bash
# Run Claude Code against a local Anthropic-compatible model server
# (llama.cpp >= b7xxx, Ollama >= 0.14, or any gateway serving /v1/messages).
#
# Models are discovered from /v1/models, never hardcoded:
#   claude-local                  # first model the server lists
#   LOCAL_MODEL=qwen claude-local # first model whose name contains "qwen"
#   /model <name>                 # switch in-session
#   LOCAL_HELPER_MODEL=claude-haiku-5-5 claude-local
#                                 # helper calls, WebSearch and safety checks on Claude (needs usage)
set -euo pipefail

base="${LOCAL_MODEL_BASE_URL:-@defaultBaseUrl@}"
base="${base%/}"
# A Claude model here takes Claude Code's Haiku role (titles, summaries, reading
# fetched pages), WebSearch and auto mode's safety checks over the claude.ai
# login. Without one the local model does everything and the shim answers
# WebSearch from Exa's free search.
helper="${LOCAL_HELPER_MODEL:-}"

if ! command -v claude > /dev/null; then
  echo "claude-local: claude is not on PATH" >&2
  exit 1
fi

if ! catalog=$(curl -fsS -m 5 "$base/v1/models"); then
  echo "claude-local: no model server at $base (override with LOCAL_MODEL_BASE_URL)" >&2
  exit 1
fi

# llama.cpp serves gguf paths as model ids, and Claude Code shows the id verbatim
# in /model and the status line. Name each model after its file and let the shim
# put the server's id back. Names that would collide keep the full id.
export CLAUDE_LOCAL_MODELS
CLAUDE_LOCAL_MODELS=$(jq -c '[.data[].id]
  | map({id: ., name: (split("/") | last | sub("\\.gguf$"; ""))})
  | group_by(.name)
  | map(if length == 1 then .[0] else map({id: .id, name: .id}) end)
  | flatten | map({key: .name, value: .id}) | from_entries' <<< "$catalog")
names=$(jq -r 'keys_unsorted[]' <<< "$CLAUDE_LOCAL_MODELS")

if [ -z "$names" ]; then
  echo "claude-local: $base/v1/models listed no models" >&2
  exit 1
fi

if ! model=$(printf '%s\n' "$names" | grep -i -m1 -F "${LOCAL_MODEL:-}"); then
  echo "claude-local: no model matching '${LOCAL_MODEL:-}' at $base. Available:" >&2
  printf '  %s\n' "$names" >&2
  exit 1
fi

# Claude Code assumes 200k for models it does not know; use the served window.
context=$(jq -r --arg m "$model" \
  '(env.CLAUDE_LOCAL_MODELS | fromjson)[$m] as $id
   | .data[] | select(.id == $id) | .meta.n_ctx // .meta.n_ctx_train // empty' <<< "$catalog")
if [ -n "$context" ]; then
  export CLAUDE_CODE_MAX_CONTEXT_TOKENS="$context"
fi

# Keep the claude.ai login: any API key or token takes precedence over it and
# turns off claude.ai connectors. The shim passes credentials only to Anthropic.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export ANTHROPIC_MODEL="$model"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${helper:-$model}"
export CLAUDE_LOCAL_HELPER_MODEL="$helper"
# Keep every subagent on the local model, even when CLAUDE.md asks for haiku,
# which the helper maps to Claude.
export CLAUDE_CODE_SUBAGENT_MODEL="$model"
export CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1
# The shim adds this file's text to the system prompt of every agent turn.
export CLAUDE_LOCAL_NOTES="@notes@"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# A local server cannot run auto mode's server-side safety checks, so stop
# Claude Code asking for them and holding the first action behind a notice.
export CLAUDE_CODE_AUTO_MODE_SERVER=0
# Tools load on demand. The shim gives a loaded tool's definition to the model
# at the end of the prompt instead of in its tool list, which would make the
# server read the conversation again (see inlineLoadedTools in the shim).
export ENABLE_TOOL_SEARCH=true
# Connect the connectors before the first request; otherwise a prompt sent at
# startup (Paseo, -p) goes out without them and the model concludes they are missing.
export MCP_CONNECTION_NONBLOCKING=0

# The shim sets ANTHROPIC_BASE_URL to its own port and runs claude as its child.
exec node "@shim@" "$base" claude "$@"
