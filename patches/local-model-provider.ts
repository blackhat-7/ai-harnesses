import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "http://pc:6868/v1";

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
  const response = await fetch(`${BASE_URL}/models`, { signal });
  if (!response.ok) throw new Error(`Local model discovery failed: HTTP ${response.status}`);

  const { data } = (await response.json()) as ModelResponse;
  return data.map((model) => {
    const id = modelId(model.id);
    return {
      id,
      name: id,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.meta?.n_ctx ?? model.meta?.n_ctx_train ?? 128000,
      maxTokens: 8192,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
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
