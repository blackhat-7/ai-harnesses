#!/usr/bin/env bash
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
dir="${cwd/#$HOME/~}"; IFS='/' read -ra parts <<< "$dir"; count="${#parts[@]}"
[ "$count" -gt 3 ] && dir="…/${parts[$((count-3))]}/${parts[$((count-2))]}/${parts[$((count-1))]}"
git_info=""
if git_branch=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null); then
  flags=""; s=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)
  [ "$(echo "$s" | grep -c '^[MADRC]' || true)" -gt 0 ] && flags="${flags}+"
  [ "$(echo "$s" | grep -c '^ M\| M' || true)" -gt 0 ] && flags="${flags}!"
  [ "$(echo "$s" | grep -c '^??' || true)" -gt 0 ] && flags="${flags}?"
  git_info=" on  ${git_branch}"; [ -n "$flags" ] && git_info="${git_info} [$flags]"
fi
python_info=""; [ -n "$VIRTUAL_ENV" ] && python_info=" via 🐍($(basename "$VIRTUAL_ENV"))"
ctx_info=""; [ -n "$used_pct" ] && printf -v ctx_rounded "%.0f" "$used_pct" && ctx_info=" | ctx ${ctx_rounded}%"
model_info=""; [ -n "$model" ] && model_info=" | ${model}"
printf "\033[1;36m%s\033[0m" "$dir"; printf "\033[1;35m%s\033[0m" "$git_info"
[ -n "$python_info" ] && printf "\033[1;33m%s\033[0m" "$python_info"
printf "\033[0;37m%s%s\033[0m\n" "$ctx_info" "$model_info"
