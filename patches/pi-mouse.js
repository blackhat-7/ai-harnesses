const ESC = "\x1b";
const ENABLE_MOUSE = `${ESC}[?1000h${ESC}[?1006h`;
const DISABLE_MOUSE = `${ESC}[?1000l${ESC}[?1006l`;
const terminalRefs = new WeakMap();

function isMouseEvent(data) {
  return typeof data === "string" && ((data.startsWith(`${ESC}[<`) && /[mM]$/.test(data)) || data.startsWith(`${ESC}[M`));
}

function parseWheel(data, step = 3) {
  const parsed = parseMouse(data);
  if (!parsed || !parsed.wheel) return undefined;
  const sign = parsed.direction === "up" || parsed.direction === "left" ? -1 : 1;
  return {
    ...parsed,
    delta: sign * step,
    deltaY: parsed.direction === "up" || parsed.direction === "down" ? sign * step : 0,
    deltaX: parsed.direction === "left" || parsed.direction === "right" ? sign * step : 0,
  };
}

function parseMouse(data) {
  if (typeof data !== "string") return undefined;

  let button;
  let x;
  let y;
  if (data.startsWith(`${ESC}[<`) && /[mM]$/.test(data)) {
    const parts = data.slice(3, -1).split(";");
    if (parts.length !== 3) return undefined;
    button = Number(parts[0]);
    x = Number(parts[1]);
    y = Number(parts[2]);
  } else if (data.startsWith(`${ESC}[M`) && data.length >= 6) {
    button = data.charCodeAt(3) - 32;
    x = data.charCodeAt(4) - 32;
    y = data.charCodeAt(5) - 32;
  } else {
    return undefined;
  }

  if (!Number.isFinite(button) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const direction = wheelDirection(button);
  return { raw: data, button, x, y, wheel: direction !== undefined, direction };
}

function wheelDirection(button) {
  if ((button & 64) === 0) return undefined;
  switch (button & 3) {
    case 0:
      return "up";
    case 1:
      return "down";
    case 2:
      return "left";
    case 3:
      return "right";
    default:
      return undefined;
  }
}

function capture({ ui, tui, onWheel, onMouse, consume = true, step = 3 } = {}) {
  const releaseMouse = enable(tui);
  const offInput = ui?.onTerminalInput?.((data) => {
    if (!isMouseEvent(data)) return undefined;
    const mouse = parseMouse(data);
    const wheel = parseWheel(data, step);
    if (wheel) onWheel?.(wheel);
    if (mouse) onMouse?.(mouse);
    return consume ? { consume: true } : undefined;
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    offInput?.();
    releaseMouse();
  };
}

function enable(tui) {
  const terminal = tui?.terminal;
  if (!terminal || typeof terminal.write !== "function") return () => {};

  const count = terminalRefs.get(terminal) || 0;
  if (count === 0) terminal.write(ENABLE_MOUSE);
  terminalRefs.set(terminal, count + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (terminalRefs.get(terminal) || 1) - 1;
    if (next <= 0) {
      terminalRefs.delete(terminal);
      terminal.write(DISABLE_MOUSE);
    } else {
      terminalRefs.set(terminal, next);
    }
  };
}

function installPiMouse() {
  globalThis.piMouse = { capture, enable, isMouseEvent, parseMouse, parseWheel };
}

module.exports = installPiMouse;
module.exports.capture = capture;
module.exports.enable = enable;
module.exports.isMouseEvent = isMouseEvent;
module.exports.parseMouse = parseMouse;
module.exports.parseWheel = parseWheel;
