import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ChutesModel = {
  id: string;
  name?: string;
  max_model_len?: number;
  max_tokens?: number;
};

const CHUTES_BASE_URL = "https://llm.chutes.ai/v1";

// Keep pi startup fast and non-flaky: do not fetch Chutes models during extension load.
// A transient Chutes /models failure used to make startup slow and unregister the provider,
// which then tripped enabledModels: ["chutes/**"]. Update this list when Chutes changes models.
const CHUTES_MODELS: ChutesModel[] = [
  { id: "Qwen/Qwen3-32B-TEE", max_model_len: 40960 },
  { id: "google/gemma-4-31B-turbo-TEE", max_model_len: 262144 },
  { id: "zai-org/GLM-5.1-TEE", max_model_len: 202752 },
  { id: "deepseek-ai/DeepSeek-V3.2-TEE", max_model_len: 131072 },
  { id: "Qwen/Qwen3.5-397B-A17B-TEE", max_model_len: 262144 },
  { id: "moonshotai/Kimi-K2.5-TEE", max_model_len: 262144 },
  { id: "zai-org/GLM-5-TEE", max_model_len: 202752 },
  { id: "Qwen/Qwen3.6-27B-TEE", max_model_len: 262144 },
  { id: "moonshotai/Kimi-K2.6-TEE", max_model_len: 262144 },
  { id: "MiniMaxAI/MiniMax-M2.5-TEE", max_model_len: 196608 },
  { id: "Qwen/Qwen3-235B-A22B-Thinking-2507-TEE", max_model_len: 262144 },
  { id: "zai-org/GLM-5.2-TEE", max_model_len: 1048576 },
  { id: "unsloth/Mistral-Nemo-Instruct-2407-TEE", max_model_len: 131072 },
];

export default function (pi: ExtensionAPI) {
  pi.registerProvider("chutes", {
    name: "Chutes",
    baseUrl: CHUTES_BASE_URL,
    apiKey: "$CHUTES_API_KEY",
    api: "openai-completions",
    models: CHUTES_MODELS.map((model) => {
      const contextWindow = model.max_model_len ?? 128000;

      return {
        id: model.id,
        name: model.name ?? model.id,
        reasoning: false,
        input: ["text"] as const,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: model.max_tokens ?? Math.min(contextWindow, 16384),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      };
    }),
  });
}
