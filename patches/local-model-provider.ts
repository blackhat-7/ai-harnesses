import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "http://pc:6868/v1";
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

async function discoverModels(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const response = await fetch(`${BASE_URL}/models`, {
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
      maxTokens: 8192,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
      },
    };
  });
}

export default async function (pi: ExtensionAPI) {
  let models: Awaited<ReturnType<typeof discoverModels>> = [];
  try {
    models = await discoverModels();
  } catch {}

  pi.registerProvider("local-models", {
    name: "Local Models",
    baseUrl: BASE_URL,
    apiKey: "local",
    api: "openai-completions",
    models,
    refreshModels: ({ signal }) => discoverModels(signal),
  });
}
