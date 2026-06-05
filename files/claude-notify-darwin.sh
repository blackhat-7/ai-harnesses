#!/usr/bin/env bash
input=$(cat); event=$(printf '%s' "$input" | jq -r '.hook_event_name // ""'); cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
session_id=$(printf '%s' "$input" | jq -r '.session_id // ""'); message=$(printf '%s' "$input" | jq -r '.message // ""')
if [ "$event" = "Notification" ] && printf '%s' "$message" | grep -qiE "waiting for (your )?input"; then exit 0; fi
front_bundle=$(lsappinfo info -only bundleid "$(lsappinfo front)" 2>/dev/null | cut -d'"' -f4)
[ "$front_bundle" = "net.kovidgoyal.kitty" ] && exit 0
label=$(basename "$cwd" 2>/dev/null); [ -z "$label" ] && label="claude"
[ "$event" = "Stop" ] && message="Done"; title="Claude · $label"
group="claude-code"; [ -n "$session_id" ] && group="claude-code-$session_id"
args=(-title "$title" -message "$message" -group "$group"); [ -f "$HOME/.claude/icon.png" ] && args+=(-appIcon "$HOME/.claude/icon.png")
@terminalNotifier@ "${args[@]}"
