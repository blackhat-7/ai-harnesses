import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ChutesModel = {
  id: string;
  name?: string;
  pricing?: {
    prompt?: number;
    completion?: number;
    input_cache_read?: number;
  };
  price?: {
    input?: { usd?: number };
    output?: { usd?: number };
    input_cache_read?: { usd?: number };
  };
  max_model_len?: number;
  max_tokens?: number;
};

type ChutesModelsResponse = {
  data?: ChutesModel[];
};

const CHUTES_BASE_URL = "https://llm.chutes.ai/v1";

function price(model: ChutesModel, key: "input" | "output" | "input_cache_read", fallbackKey: "prompt" | "completion" | "input_cache_read") {
  return model.price?.[key]?.usd ?? model.pricing?.[fallbackKey] ?? 0;
}

export default async function (pi: ExtensionAPI) {
  const response = await fetch(CHUTES_BASE_URL + "/models");
  if (!response.ok) throw new Error("Failed to fetch Chutes models: " + response.status + " " + response.statusText);

  const payload = (await response.json()) as ChutesModelsResponse;
  const models = (payload.data ?? []).map((model) => {
    const contextWindow = model.max_model_len ?? 128000;

    return {
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"] as const,
      cost: {
        input: price(model, "input", "prompt"),
        output: price(model, "output", "completion"),
        cacheRead: price(model, "input_cache_read", "input_cache_read"),
        cacheWrite: 0,
      },
      contextWindow,
      maxTokens: model.max_tokens ?? Math.min(contextWindow, 16384),
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    };
  });

  pi.registerProvider("chutes", {
    name: "Chutes",
    baseUrl: CHUTES_BASE_URL,
    apiKey: "$CHUTES_API_KEY",
    api: "openai-completions",
    models,
  });
}
