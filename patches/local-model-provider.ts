import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "http://pc:6868/v1";
// CPU llama-server for background jobs (`lct up local` starts both); its model is served as "side".
const SIDE_URL = "http://pc:6869/v1";
export const SIDE_MODEL = "local-side/side";
// Startup awaits discovery (directly and via refreshModels); the LAN server answers well under this.
const DISCOVERY_TIMEOUT_MS = 1000;

type ModelResponse = {
  data: Array<{
    id: string;
    meta?: {
      n_ctx?: number;
      n_ctx_train?: number;
    };
  }>;
};

export function modelId(id: string): string {
  if (!id.toLowerCase().endsWith(".gguf")) return id;
  return (id.split(/[\\/]/).pop() ?? id).slice(0, -5);
}

async function discoverModels(baseUrl: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const response = await fetch(`${baseUrl}/models`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Local model discovery failed: HTTP ${response.status}`);

  const { data } = (await response.json()) as ModelResponse;
  return data.map((model) => {
    const id = modelId(model.id);
    return {
      id,
      name: id,
      reasoning: true,
      thinkingLevelMap: {
        off: "none",
        ...(id.includes("Qwen3.8")
          ? { minimal: "low", high: "xhigh", xhigh: "xhigh" }
          : {}),
      },
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.meta?.n_ctx ?? model.meta?.n_ctx_train ?? 128000,
      maxTokens: 32768,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
      },
    };
  });
}

async function discoverOrExplain(baseUrl: string) {
  try {
    const models = await discoverModels(baseUrl);
    if (models.length) return models;
  } catch {}
  throw new Error(`no model at ${baseUrl}; start the servers with 'lct up local'`);
}

export default async function (pi: ExtensionAPI) {
  // `pi --local`: the session and the side roles run on the local servers. Side roles
  // (titles, memory reviews) name local-side first and fall back to cloud Haiku, so
  // the side provider is registered only in local mode. pi-automode takes one model
  // and reads this variable when it loads its config at session start.
  pi.registerFlag("local", { description: "Use the local main and side models", type: "boolean" });
  if (process.argv.includes("--local")) {
    process.env.PI_AUTOMODE_SETTINGS_JSON = JSON.stringify({
      autoMode: { classifierModel: SIDE_MODEL },
    });
  }

  let models: Awaited<ReturnType<typeof discoverModels>> = [];
  try {
    models = await discoverModels(BASE_URL);
  } catch {}

  const registerMain = (models: Awaited<ReturnType<typeof discoverModels>>) =>
    pi.registerProvider("local-models", {
      name: "Local Models",
      baseUrl: BASE_URL,
      apiKey: "local",
      api: "openai-completions",
      models,
      refreshModels: ({ signal }) => discoverModels(BASE_URL, signal),
    });
  registerMain(models);

  pi.on("session_start", async (_event, ctx) => {
    if (!pi.getFlag("local")) return;
    try {
      const [main, side] = await Promise.all([discoverOrExplain(BASE_URL), discoverOrExplain(SIDE_URL)]);
      pi.registerProvider("local-side", {
        name: "Local Side",
        baseUrl: SIDE_URL,
        apiKey: "local",
        api: "openai-completions",
        models: side,
      });
      registerMain(main);
      const model = ctx.modelRegistry.find("local-models", main[0].id);
      if (!model || !(await pi.setModel(model))) throw new Error(`cannot select local-models/${main[0].id}`);
    } catch (error) {
      // Printed on exit, after the TUI has restored the terminal; print mode has no
      // shutdown handler, so it exits directly.
      process.once("exit", () => console.error(`pi --local: ${(error as Error).message}`));
      if (ctx.hasUI) ctx.shutdown();
      else process.exit(1);
    }
  });
}
