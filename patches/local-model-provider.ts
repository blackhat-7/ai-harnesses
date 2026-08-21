import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "http://pc:6868/v1";

type ModelResponse = {
  data: Array<{
    meta?: {
      n_ctx?: number;
      n_ctx_train?: number;
    };
  }>;
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider("local-model", {
    name: "Local Model",
    baseUrl: BASE_URL,
    apiKey: "local",
    api: "openai-completions",
    async refreshModels({ signal }) {
      const response = await fetch(`${BASE_URL}/models`, { signal });
      if (!response.ok) throw new Error(`Local model discovery failed: HTTP ${response.status}`);

      const model = ((await response.json()) as ModelResponse).data[0];
      if (!model) return [];

      return [
        {
          id: "local-model",
          name: "Local Model",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.meta?.n_ctx ?? model.meta?.n_ctx_train ?? 128000,
          maxTokens: 8192,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
        },
      ];
    },
  });
}
