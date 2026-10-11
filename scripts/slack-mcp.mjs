#!/usr/bin/env node
// Stdio MCP server with one `slack` tool. Only Claude Code has the claude.ai Slack
// connector, so each call runs headless Claude Code (Haiku) limited to the
// connector's read-only tools and returns its answer.
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";

const READ_TOOLS = [
  "get_reactions",
  "list_channel_members",
  "list_user_channels",
  "read_canvas",
  "read_channel",
  "read_file",
  "read_list",
  "read_thread",
  "read_user_profile",
  "search_channels",
  "search_emojis",
  "search_public",
  "search_public_and_private",
  "search_users",
].map((name) => `mcp__claude_ai_Slack__slack_${name}`);

const SYSTEM_PROMPT =
  "You answer Slack questions for another agent using the Slack tools. Quote message text verbatim with author, time and permalink. Do not paraphrase or guess.";

const claudeArgs = [
  "-p",
  "--model", "haiku",
  "--no-session-persistence",
  // ToolSearch keeps the other MCP servers' tools deferred instead of in context.
  "--tools", "ToolSearch",
  // dontAsk denies anything not allowed here, whatever the user's default mode is.
  "--permission-mode", "dontAsk",
  "--allowedTools", READ_TOOLS.join(","),
  "--append-system-prompt", SYSTEM_PROMPT,
];

const tool = {
  name: "slack",
  description:
    "Read Slack (search messages, read channels and threads, look up users and channels). Describe what you need in plain language. Read-only; slow (~10s+).",
  inputSchema: {
    type: "object",
    properties: { request: { type: "string", description: "What to find or read in Slack." } },
    required: ["request"],
  },
};

function askClaude(request) {
  return new Promise((resolve) => {
    const child = execFile(
      "claude",
      claudeArgs,
      // Without a prewait, -p answers before the claude.ai connectors finish connecting.
      { env: { ...process.env, CLAUDE_CODE_MCP_CONNECTOR_PREWAIT_MS: "20000" }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve(error ? { text: `${error.message}\n${stderr}`, isError: true } : { text: stdout.trim(), isError: false }),
    );
    child.stdin.end(request);
  });
}

async function handle({ id, method, params }) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "slack", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [tool] };
    case "tools/call": {
      if (params.name !== tool.name) throw new Error(`Unknown tool: ${params.name}`);
      const { text, isError } = await askClaude(params.arguments.request);
      return { content: [{ type: "text", text }], isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return; // notification
  try {
    send({ id: message.id, result: await handle(message) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
