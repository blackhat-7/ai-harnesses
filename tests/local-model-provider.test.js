const assert = require("node:assert/strict");
const test = require("node:test");

const {
  default: registerLocalModels,
  modelId,
} = require("../patches/local-model-provider.ts");

test("modelId shortens GGUF paths and preserves API aliases", () => {
  assert.equal(modelId("/models/Qwen-Coder-Q4_K_M.gguf"), "Qwen-Coder-Q4_K_M");
  assert.equal(modelId("C:\\models\\Llama.GGUF"), "Llama");
  assert.equal(modelId("owner/model-alias"), "owner/model-alias");
});

test("provider exposes discovered llama.cpp models at startup", async () => {
  let providerId;
  let provider;
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        {
          id: "/models/Qwen-Coder-Q4_K_M.gguf",
          meta: { n_ctx: 131072 },
        },
      ],
    }),
  });

  try {
    await registerLocalModels({
      registerProvider(id, config) {
        providerId = id;
        provider = config;
      },
    });

    assert.equal(providerId, "local-models");
    assert.equal(provider.models[0].id, "Qwen-Coder-Q4_K_M");
    assert.equal(provider.models[0].contextWindow, 131072);
  } finally {
    global.fetch = originalFetch;
  }
});
