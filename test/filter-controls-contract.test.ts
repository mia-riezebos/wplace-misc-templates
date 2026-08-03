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

test("overlay exposes and persists a selected-colour-only filter", () => {
  assert.match(source, /id="\$\{PANEL_ID\}-overlay-selected-colour"/);
  assert.match(source, />Only selected colour</);
  assert.match(source, /overlaySelectedColorOnly: state\.overlaySelectedColorOnly/);
  assert.match(source, /templatePixelMatchesSelectedColor\(/);
});

test("selected-colour overlay redraws when Wplace changes its selected swatch", () => {
  assert.match(source, /function installOverlayPaletteWatcher\(root\)/);
  assert.match(source, /attributeFilter: \["aria-pressed", "data-state", "data-selected", "class"\]/);
  assert.match(source, /requestAnimationFrame\(renderOverlay\)/);
});
