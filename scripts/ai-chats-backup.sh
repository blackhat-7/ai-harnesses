# Back up AI agent chat transcripts to a private git repo, with secrets redacted.
# Each run copies only files changed since the last successful run. Files deleted
# at the source (Claude Code drops chats after 30 days) stay in the backup.

repo_url=git@github.com:blackhat-7/ai-chats.git
repo=${XDG_DATA_HOME:-$HOME/.local/share}/ai-chats
state=${XDG_STATE_HOME:-$HOME/.local/state}/ai-chats-backup
host=$(hostname -s)
export PATH=$PATH:$HOME/.npm-global/bin

mkdir -p "$state"
[ -d "$repo/.git" ] || git clone -q "$repo_url" "$repo"

since=$(cat "$state/last-run" 2>/dev/null || echo 0)
now=$(date +%s)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stage=$work/files

# copy <dest> <root> <path>...: files under <root>/<path> changed since the last run.
# GitHub rejects files over 100 MB, so bigger ones are skipped.
copy() {
  local dest=$stage/$1 root=$2
  shift 2
  [ -d "$root" ] || return 0
  mkdir -p "$dest"
  (cd "$root" && find "$@" -type f -newermt "@$since" ! -size -95M -printf "skipped, over 95 MB: $root/%p\n" 2>/dev/null) >&2 || true
  (cd "$root" && find "$@" -type f -newermt "@$since" -size -95M -print0 2>/dev/null || true) |
    rsync -a --from0 --files-from=- "$root/" "$dest/"
}

copy claude ~/.claude projects history.jsonl
copy pi ~/.pi/agent sessions
copy codex ~/.codex sessions history.jsonl session_index.jsonl
copy paseo ~/.paseo agents

# `opencode session list` hides subagent and some older chats, so read the ids
# from its database.
opencode_db=$HOME/.local/share/opencode/opencode.db
if [ -f "$opencode_db" ]; then
  mkdir -p "$stage/opencode"
  sqlite3 -readonly "$opencode_db" "select id from session where time_updated >= $since * 1000" |
    while read -r id; do
      (cd ~ && opencode export "$id" </dev/null >"$stage/opencode/$id.json" 2>/dev/null)
    done
fi

scan() {
  gitleaks dir "$stage" --no-banner --log-level error --exit-code 0 --report-format json --report-path "$1"
}

# Replace each secret gitleaks finds with a [REDACTED:<rule>] marker, until a scan
# comes back clean: redacting one secret can expose another that overlapped it.
# Never commit a secret: hold back files still not clean, and log them.
for pass in 1 2 3 4; do
  scan "$work/found.json"
  [ "$(jq length "$work/found.json")" -gt 0 ] || break
  if [ "$pass" = 4 ]; then
    jq -r --arg stage "$stage/" '.[].File | ltrimstr($stage) | "held back, secret not redacted: \(.)"' \
      "$work/found.json" | sort -u >&2
    jq -j '.[] | .File, "\u0000"' "$work/found.json" | xargs -0 rm -f --
    break
  fi
  python3 - "$work/found.json" <<'EOF'
import base64, json, re, sys
from collections import defaultdict

B64 = re.compile(rb"[A-Za-z0-9+/=]")
findings = defaultdict(list)
for f in json.load(open(sys.argv[1])):
    findings[f["File"]].append(f)

for path, found in findings.items():
    with open(path, "rb") as fh:
        data = fh.read()
    subs = {}
    for f in found:
        rule, secret, match = f["RuleID"], f["Secret"].encode(), f["Match"].encode()
        marker = f"[REDACTED:{rule}]".encode()
        if any(t.startswith("decoded:") for t in f["Tags"]):
            # The secret is base64 encoded in the file, and gitleaks often reports
            # the wrong spot. Find its encoded form at each of the 3 byte
            # alignments and redact the whole base64 run around it.
            for pad in range(3):
                core = base64.b64encode(b"\0" * pad + secret)[4 if pad else 0 : -4]
                if len(core) < 16:
                    continue
                for m in re.finditer(re.escape(core), data):
                    start, end = m.start(), m.end()
                    while start > 0 and B64.match(data, start - 1):
                        start -= 1
                    while end < len(data) and B64.match(data, end):
                        end += 1
                    subs[data[start:end]] = marker
        elif rule == "generic-api-key":
            # Often just an ID, so only redact it next to its keyword.
            subs[match] = match.replace(secret, marker)
        elif secret:
            subs[secret] = marker
    # gitleaks reports a repeated secret once, so replace every copy.
    for old in sorted(subs, key=len, reverse=True):
        data = data.replace(old, subs[old])
    with open(path, "wb") as fh:
        fh.write(data)
EOF
done

rsync -a "$stage/" "$repo/$host/"
cd "$repo"
git add -A
# The global gitleaks pre-commit hook would rescan what was just checked above,
# which takes minutes for a large first backup, with rules that flag IDs.
git diff --cached --quiet || git commit -q --no-verify -m "backup($host): $(date -u +%FT%TZ)"
git pull -q --rebase
git push -q
echo "$now" >"$state/last-run"
