#!/usr/bin/env bash
input=$(cat); event=$(printf '%s' "$input" | jq -r '.hook_event_name // ""'); cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
session_id=$(printf '%s' "$input" | jq -r '.session_id // ""'); label=$(basename "$cwd" 2>/dev/null); [ -z "$label" ] && label="claude"
urgency="critical"; message=$(printf '%s' "$input" | jq -r '.message // ""'); [ "$event" = "Stop" ] && urgency="normal" && message="Done"
args=(-u "$urgency" -a "Claude Code"); [ -f "$HOME/.claude/icon.png" ] && args+=(-i "$HOME/.claude/icon.png"); [ -n "$session_id" ] && args+=(-h "string:x-dunst-stack-tag:claude-$session_id")
notify-send "${args[@]}" "Claude · $label" "$message"
