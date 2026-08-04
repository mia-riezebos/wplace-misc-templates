import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("auto-paint exposes a positive wrong-colour repair toggle", () => {
  assert.match(source, /id="\$\{PANEL_ID\}-fix-wrong-colours"/);
  assert.match(source, />Fix wrong colours</);
  assert.doesNotMatch(source, />Keep existing pixels</);
  assert.match(source, /state\.fixWrongColors/);
  assert.match(source, /shouldQueuePaintPixel\(/);
});

test("overlay exposes a session-only selected-colour filter that restores off", () => {
  const persistStart = source.indexOf("  function persistTarget()");
  const persistEnd = source.indexOf("\n  async function restoreTarget()", persistStart);
  const persistTarget = source.slice(persistStart, persistEnd);
  const restoreStart = persistEnd;
  const restoreEnd = source.indexOf("\n  function renderOverlay(", restoreStart);
  const restoreTarget = source.slice(restoreStart, restoreEnd);

  assert.match(source, /id="\$\{PANEL_ID\}-overlay-selected-colour"/);
  assert.match(source, />Only selected colour</);
  assert.doesNotMatch(persistTarget, /overlaySelectedColorOnly/);
  assert.match(restoreTarget, /state\.overlaySelectedColorOnly = false/);
  assert.match(source, /templatePixelMatchesSelectedColor\(/);
});

test("selected-colour overlay redraws when Wplace changes its selected swatch", () => {
  assert.match(source, /function installOverlayPaletteWatcher\(root\)/);
  assert.match(source, /attributeFilter: \["aria-pressed", "data-state", "data-selected", "class"\]/);
  assert.match(source, /requestAnimationFrame\(renderOverlay\)/);
});
