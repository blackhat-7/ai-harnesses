import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// `pi --lean` shrinks the fixed prompt for small-context (local) models: tools matching
// `excludeTools` are not declared, and only the skills named in `skills` are listed. Unlisted
// skills still run through /skill:name. lean.json in the agent dir is written by pi.nix.
type LeanConfig = { excludeTools: string[]; skills: string[] };

// `*` matches any run of characters, as in pi's own --exclude-tools.
export function matcher(patterns: string[]): (name: string) => boolean {
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(?:${patterns.map((p) => p.split("*").map(escape).join(".*")).join("|")})$`);
  return (name) => re.test(name);
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("lean", { description: "Smaller prompt: fewer tools and skills (lean.json)", type: "boolean" });

  // Applied before every prompt: MCP tools register after their servers connect, mid-session.
  pi.on("before_agent_start", (event) => {
    if (!pi.getFlag("lean")) return;
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    const config: LeanConfig = JSON.parse(readFileSync(join(agentDir, "lean.json"), "utf8"));
    const excluded = matcher(config.excludeTools);
    pi.setActiveTools(pi.getActiveTools().filter((name) => !excluded(name)));
    const options = event.systemPromptOptions;
    options.skills = options.skills.filter((skill) => config.skills.includes(skill.name));
    options.selectedTools = options.selectedTools.filter((name) => !excluded(name));
  });
}
