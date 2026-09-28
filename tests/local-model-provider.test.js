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
      registerFlag() {},
      on() {},
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

test("startup and refresh give up on an unreachable host instead of hanging", async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  try {
    let provider;
    await registerLocalModels({
      registerFlag() {},
      on() {},
      registerProvider(_id, config) {
        provider = config;
      },
    });

    assert.deepEqual(provider.models, []);
    await assert.rejects(provider.refreshModels({ signal: new AbortController().signal }));
  } finally {
    global.fetch = originalFetch;
  }
});

function fakePi(argvLocal) {
  const pi = {
    providers: {},
    selected: undefined,
    shutdown: false,
    registerFlag() {},
    getFlag: (name) => name === "local" && argvLocal,
    registerProvider(id, config) {
      pi.providers[id] = config;
    },
    on(event, handler) {
      pi[event] = handler;
    },
    async setModel(model) {
      pi.selected = model;
      return true;
    },
  };
  const ctx = {
    modelRegistry: {
      find: (provider, id) => pi.providers[provider]?.models.find((m) => m.id === id),
    },
    hasUI: true,
    shutdown: () => {
      pi.shutdown = true;
    },
  };
  return { pi, ctx };
}

test("local mode selects the local main model and registers the side model", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    json: async () => ({
      data: [{ id: String(url).includes(":6869") ? "side" : "/m/Main.gguf" }],
    }),
  });
  const { pi, ctx } = fakePi(true);

  try {
    await registerLocalModels(pi);
    await pi.session_start({}, ctx);

    assert.equal(pi.selected.id, "Main");
    assert.equal(pi.providers["local-side"].models[0].id, "side");
    assert.equal(pi.shutdown, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("local mode exits with a clear error when a server is down", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes(":6869")) throw new Error("refused");
    return { ok: true, json: async () => ({ data: [{ id: "main" }] }) };
  };
  const { pi, ctx } = fakePi(true);

  try {
    await registerLocalModels(pi);
    await pi.session_start({}, ctx);

    assert.equal(pi.shutdown, true);
    assert.equal(pi.providers["local-side"], undefined);
    const messages = [];
    const originalError = console.error;
    console.error = (message) => messages.push(message);
    try {
      process.emit("exit", 0);
    } finally {
      console.error = originalError;
    }
    assert.match(messages[0], /6869.*lct up local/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("without --local nothing changes at session start", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  const { pi, ctx } = fakePi(false);

  try {
    await registerLocalModels(pi);
    await pi.session_start({}, ctx);

    assert.equal(pi.selected, undefined);
    assert.equal(pi.providers["local-side"], undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
