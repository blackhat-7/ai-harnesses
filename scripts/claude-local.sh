#!/usr/bin/env bash
# Run Claude Code against a local Anthropic-compatible model server
# (llama.cpp >= b7xxx, Ollama >= 0.14, or any gateway serving /v1/messages).
#
# Models are discovered from /v1/models, never hardcoded:
#   claude-local                  # first model the server lists
#   LOCAL_MODEL=qwen claude-local # first model whose name contains "qwen"
#   /model <name>                 # switch in-session
set -euo pipefail

base="${LOCAL_MODEL_BASE_URL:-@defaultBaseUrl@}"
base="${base%/}"

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

unset ANTHROPIC_API_KEY
export ANTHROPIC_AUTH_TOKEN="local"
export ANTHROPIC_MODEL="$model"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$model"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# MCP tool definitions are sent in full on every request and easily outweigh a
# local context window (874 tools measured at ~695k tokens here), so local
# sessions start with none. Pass --mcp-config to choose servers explicitly.
mcp="--strict-mcp-config"
case " $* " in *" --mcp-config "*) mcp="" ;; esac

# The shim sets ANTHROPIC_BASE_URL to its own port and runs claude as its child.
exec node "@shim@" "$base" claude ${mcp:+"$mcp"} "$@"
