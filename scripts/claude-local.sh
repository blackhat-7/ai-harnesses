#!/usr/bin/env bash
# Run Claude Code against a local Anthropic-compatible model server
# (llama.cpp >= b7xxx, Ollama >= 0.14, or any gateway serving /v1/messages).
#
# Models are discovered from /v1/models, never hardcoded:
#   claude-local                  # first model the server lists
#   LOCAL_MODEL=qwen claude-local # first model whose id contains "qwen"
#   /model <name>                 # switch in-session; the picker lists local models
set -euo pipefail

base="${LOCAL_MODEL_BASE_URL:-@defaultBaseUrl@}"
base="${base%/}"

if ! command -v claude > /dev/null; then
  echo "claude-local: claude is not on PATH" >&2
  exit 1
fi

if ! catalog=$(curl -fsS -m 5 "$base/v1/models") || ! ids=$(jq -e -r '.data[].id' <<< "$catalog"); then
  echo "claude-local: no model server at $base (override with LOCAL_MODEL_BASE_URL)" >&2
  exit 1
fi

if ! model=$(printf '%s\n' "$ids" | grep -i -m1 -F "${LOCAL_MODEL:-}"); then
  echo "claude-local: no model matching '${LOCAL_MODEL:-}' at $base. Available:" >&2
  printf '  %s\n' "$ids" >&2
  exit 1
fi

# Label picker rows with the bare model name; keep the server's id as the value.
settings=$(printf '%s\n' "$ids" | jq -R -s -c \
  '{modelPicker: [splits("\n") | select(length > 0)
    | {id: ., name: (split("/") | last | sub("\\.gguf$"; ""))}]}')

# Claude Code assumes 200k for models it does not know; use the served window.
context=$(jq -r --arg m "$model" \
  '.data[] | select(.id == $m) | .meta.n_ctx // .meta.n_ctx_train // empty' <<< "$catalog")
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

# The shim sets ANTHROPIC_BASE_URL to its own port and runs claude as its child.
exec node "@shim@" "$base" claude --settings "$settings" "$@"
