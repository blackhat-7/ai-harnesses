#!/usr/bin/env node
// Stdio MCP server with one `slack` tool. Only Claude Code has the claude.ai Slack
// connector, so each call runs headless Claude Code (Haiku) limited to the
// connector's read-only tools and returns its answer.
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const SYSTEM_PROMPT = [
  "You answer Slack questions for another agent using the Slack tools. Never guess.",
  "For a long time range, split it into one window per day and read all windows in parallel in one turn,",
  "with response_format concise and limit 25, following cursors until done.",
  "For counts and stats, answer with the numbers and a few examples, not every message.",
  "When asked for messages, quote them verbatim with author, time and permalink.",
].join(" ");

const SLACK_ONLY = { allowedMcpServers: [{ serverUrl: "https://mcp.slack.com/*" }] };

// Export mode: a hook appends every Slack tool response verbatim to `file`, so counts
// come from code over the raw pages instead of from Haiku copying rows.
function exportSettings(file) {
  const command = `cat >> '${file}' && echo >> '${file}'`;
  return { ...SLACK_ONLY, hooks: { PostToolUse: [{ matcher: "mcp__claude_ai_Slack__.*", hooks: [{ type: "command", command }] }] } };
}

const EXPORT_FORMAT =
  "One JSON object per line, one per Slack tool call: tool_name, tool_input, and tool_response[0].text, which is the Slack tool's own JSON. In read_channel results its `messages` string holds the messages, each ending with its [YYYY-MM-DD HH:MM:SS TZ] time. Parse and count with code.";

// Lean like a one-shot call: only the Slack connector loads, no built-in tools, and a
// short system prompt in place of Claude Code's default one.
const claudeArgs = (settings) => [
  "-p",
  "--model", "haiku",
  "--no-session-persistence",
  "--settings", JSON.stringify(settings),
  "--tools", "",
  // dontAsk denies anything not allowed here, whatever the user's default mode is.
  "--permission-mode", "dontAsk",
  "--allowedTools", READ_TOOLS.join(","),
  "--system-prompt", SYSTEM_PROMPT,
];

const tool = {
  name: "slack",
  description:
    "Read Slack (search messages, read channels and threads, look up users and channels). Describe everything you need in one plain-language request; it reads in parallel itself. Read-only. ~6s for a lookup. For stats, counts or anything that must be exact, set export: true and compute the numbers with code from the returned file.",
  inputSchema: {
    type: "object",
    properties: {
      request: { type: "string", description: "What to find or read in Slack." },
      export: { type: "boolean", description: "Save the raw Slack pages to a file and return its path instead of a summary." },
    },
    required: ["request"],
  },
};

// https permalinks open the browser; slack:// links open the desktop app at the message.
function appLinks(text) {
  return text.replace(
    /https:\/\/\S*?\/archives\/(\w+)\/p(\d{10})(\d{6})(?:\?[\w=.&%-]*)?/g,
    "slack://channel?id=$1&message=$2.$3",
  );
}

// Request id -> its running claude, so a cancelled call stops using quota.
const running = new Map();

function askClaude(id, request, settings) {
  return new Promise((resolve) => {
    const child = execFile(
      "claude",
      claudeArgs(settings),
      // Otherwise -p can answer before the Slack connector finishes connecting.
      { env: { ...process.env, MCP_CONNECTION_NONBLOCKING: "0" }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        running.delete(id);
        resolve(error ? { text: `${error.message}\n${stderr}`, isError: true } : { text: appLinks(stdout.trim()), isError: false });
      },
    );
    running.set(id, child);
    // Claude Code knows the date but not the timezone, which "today" and "last 4 days" need.
    child.stdin.end(`Current local time: ${new Date().toString()}\n\n${request}`);
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
      const { request, export: exported } = params.arguments;
      if (!exported) {
        const { text, isError } = await askClaude(id, request, SLACK_ONLY);
        return { content: [{ type: "text", text }], isError };
      }
      const file = join(tmpdir(), `slack-export-${Date.now()}.jsonl`);
      const prompt = `${request}\n\nExport mode: fetch every page this needs, but do not copy or count messages. Reply with only what you fetched.`;
      const { text, isError } = await askClaude(id, prompt, exportSettings(file));
      return { content: [{ type: "text", text: isError ? text : `${text}\n\nRaw pages: ${file}\n${EXPORT_FORMAT}` }], isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

createInterface({ input: process.stdin })
  .on("line", async (line) => {
    const message = JSON.parse(line);
    if (message.method === "notifications/cancelled") running.get(message.params.requestId)?.kill();
    if (message.id === undefined) return; // notification
    try {
      send({ id: message.id, result: await handle(message) });
    } catch (error) {
      send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
    }
  })
  .on("close", () => {
    for (const child of running.values()) child.kill();
  });
