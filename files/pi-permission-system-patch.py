#!/usr/bin/env python3
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
path = root / "src/permission-forwarding.ts"
text = path.read_text()
old = 'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;'
new = 'export const SUBAGENT_ENV_HINT_KEYS = ["PI_IS_SUBAGENT", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_SESSION_ID", "PI_AGENT_ROUTER_SUBAGENT"] as const;'
if new not in text:
    if old not in text:
        raise SystemExit(f"Could not apply pi-permission-system subagent env patch to {path}")
    path.write_text(text.replace(old, new))
