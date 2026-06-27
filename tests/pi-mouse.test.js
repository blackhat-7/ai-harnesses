const test = require("node:test");
const assert = require("node:assert/strict");

const piMouse = require("../files/pi-mouse.js");

test("parseWheel handles SGR vertical wheel events", () => {
  assert.deepEqual(piMouse.parseWheel("\x1b[<64;10;5M"), {
    raw: "\x1b[<64;10;5M",
    button: 64,
    x: 10,
    y: 5,
    wheel: true,
    direction: "up",
    delta: -3,
    deltaY: -3,
    deltaX: 0,
  });
  assert.equal(piMouse.parseWheel("\x1b[<65;10;5M").deltaY, 3);
});

test("parseWheel handles legacy xterm wheel events", () => {
  const raw = `\x1b[M${String.fromCharCode(32 + 64)}!!`;
  assert.equal(piMouse.parseWheel(raw).direction, "up");
  assert.equal(piMouse.parseWheel(raw).deltaY, -3);
});

test("capture enables mouse reporting once per terminal and disables after last release", () => {
  const writes = [];
  const terminal = { write: (s) => writes.push(s) };
  const tui = { terminal };
  const ui = { onTerminalInput: () => () => writes.push("off") };

  const release1 = piMouse.capture({ ui, tui });
  const release2 = piMouse.capture({ ui, tui });
  assert.deepEqual(writes, ["\x1b[?1000h\x1b[?1006h"]);

  release1();
  assert.deepEqual(writes, ["\x1b[?1000h\x1b[?1006h", "off"]);

  release2();
  assert.deepEqual(writes, ["\x1b[?1000h\x1b[?1006h", "off", "off", "\x1b[?1000l\x1b[?1006l"]);
});

test("capture routes wheel input and consumes all mouse events", () => {
  let handler;
  const ui = { onTerminalInput: (fn) => ((handler = fn), () => {}) };
  const tui = { terminal: { write: () => {} } };
  const deltas = [];

  const release = piMouse.capture({ ui, tui, onWheel: (event) => deltas.push(event.deltaY) });
  assert.deepEqual(handler("\x1b[<64;10;5M"), { consume: true });
  assert.deepEqual(handler("\x1b[<0;10;5M"), { consume: true });
  assert.equal(handler("down"), undefined);
  release();

  assert.deepEqual(deltas, [-3]);
});

test("extension install exposes the helper globally", () => {
  delete globalThis.piMouse;
  piMouse();
  assert.equal(globalThis.piMouse.parseWheel("\x1b[<65;1;1M").direction, "down");
});
