#!/usr/bin/env node
// Stdio MCP server exposing one claude.ai connector (`slack` or `gmail`, the first
// argument) as a single tool. Only Claude Code has these connectors, so each call runs
// headless Claude Code (Haiku) limited to the connector's read-only tools.
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const CONNECTORS = {
  slack: {
    label: "Slack",
    url: "https://mcp.slack.com/*",
    toolPrefix: "mcp__claude_ai_Slack__",
    tools: [
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
    ].map((name) => `slack_${name}`),
    prompt: [
      "For a long time range, split it into one window per day and read all windows in parallel in one turn,",
      "with response_format concise and limit 25, following cursors until done.",
      "When asked for messages, quote them verbatim with author, time and permalink.",
    ],
    reads: "search messages, read channels and threads, look up users and channels",
    exportHint: "In read_channel results its `messages` string holds the messages, each ending with its [YYYY-MM-DD HH:MM:SS TZ] time.",
    // https permalinks open the browser; slack:// links open the desktop app at the message.
    links: (text) =>
      text.replace(
        /https:\/\/\S*?\/archives\/(\w+)\/p(\d{10})(\d{6})(?:\?[\w=.&%-]*)?/g,
        "slack://channel?id=$1&message=$2.$3",
      ),
  },
  gmail: {
    label: "Gmail",
    url: "https://gmailmcp.googleapis.com/*",
    toolPrefix: "mcp__claude_ai_Gmail__",
    tools: ["search_threads", "get_thread", "get_message", "list_labels", "list_drafts", "get_draft"],
    prompt: [
      "Use Gmail search operators (from:, to:, subject:, after:, before:, is:unread, label:) and follow page tokens until done.",
      "When asked for emails, give sender, date and subject, and quote the relevant text verbatim.",
    ],
    reads: "search mail, read threads, messages, labels and drafts",
    exportHint: "search_threads results hold `threads`, each with its `messages` and their headers.",
    links: (text) => text,
  },
};

const connector = CONNECTORS[process.argv[2]];
if (!connector) throw new Error(`Usage: connector-mcp.mjs ${Object.keys(CONNECTORS).join("|")}`);
const { label } = connector;

const SYSTEM_PROMPT = [
  `You answer ${label} questions for another agent using the ${label} tools. Never guess.`,
  ...connector.prompt,
  "For counts and stats, answer with the numbers and a few examples, not every item.",
].join(" ");

const CONNECTOR_ONLY = { allowedMcpServers: [{ serverUrl: connector.url }] };

// Export mode: a hook appends every connector tool response verbatim to `file`, so counts
// come from code over the raw pages instead of from Haiku copying rows.
function exportSettings(file) {
  const command = `cat >> '${file}' && echo >> '${file}'`;
  const matcher = `${connector.toolPrefix}.*`;
  return { ...CONNECTOR_ONLY, hooks: { PostToolUse: [{ matcher, hooks: [{ type: "command", command }] }] } };
}

const EXPORT_FORMAT = `One JSON object per line, one per ${label} tool call: tool_name, tool_input and tool_response, the tool's result as a JSON string or as [{ text }] holding it. Skip results starting with "Error:": an oversized page, fetched again in smaller pages. ${connector.exportHint} Parse and count with code.`;

// Lean like a one-shot call: only this connector loads, no built-in tools, and a short
// system prompt in place of Claude Code's default one.
const claudeArgs = (settings) => [
  "-p",
  "--model", "haiku",
  "--no-session-persistence",
  "--settings", JSON.stringify(settings),
  "--tools", "",
  // dontAsk denies anything not allowed here, whatever the user's default mode is.
  "--permission-mode", "dontAsk",
  "--allowedTools", connector.tools.map((name) => connector.toolPrefix + name).join(","),
  "--system-prompt", SYSTEM_PROMPT,
];

const tool = {
  name: process.argv[2],
  description: `Read ${label} (${connector.reads}). Describe everything you need in one plain-language request. Read-only. ~6s for a lookup. For stats, counts or anything that must be exact, set export: true and compute the numbers with code from the returned file.`,
  inputSchema: {
    type: "object",
    properties: {
      request: { type: "string", description: `What to find or read in ${label}.` },
      export: { type: "boolean", description: `Save the raw ${label} pages to a file and return its path instead of a summary.` },
    },
    required: ["request"],
  },
};

// Request id -> its running claude, so a cancelled call stops using quota.
const running = new Map();

function askClaude(id, request, settings) {
  return new Promise((resolve) => {
    const child = execFile(
      "claude",
      claudeArgs(settings),
      // Otherwise -p can answer before the connector finishes connecting.
      { env: { ...process.env, MCP_CONNECTION_NONBLOCKING: "0" }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        running.delete(id);
        resolve(error ? { text: `${error.message}\n${stderr}`, isError: true } : { text: connector.links(stdout.trim()), isError: false });
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
        serverInfo: { name: tool.name, version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [tool] };
    case "tools/call": {
      if (params.name !== tool.name) throw new Error(`Unknown tool: ${params.name}`);
      const { request, export: exported } = params.arguments;
      if (!exported) {
        const { text, isError } = await askClaude(id, request, CONNECTOR_ONLY);
        return { content: [{ type: "text", text }], isError };
      }
      const file = join(tmpdir(), `${tool.name}-export-${Date.now()}.jsonl`);
      const prompt = `${request}\n\nExport mode: fetch every page this needs, but do not copy or count items. Reply with only what you fetched.`;
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
