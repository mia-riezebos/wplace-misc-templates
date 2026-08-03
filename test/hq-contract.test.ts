import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("HQ overlays detect the tiled artboard and keep auto-paint hidden by default", () => {
  assert.match(source, /const ENABLE_HQ_AUTO_PAINT = false/);
  assert.match(source, /aria-label="Headquarters canvas"/);
  assert.match(source, /\.hq-tile-layer/);
  assert.match(source, /data-hq-auto-paint="false"[\s\S]*\.waa-paint \{ display: none; \}/);
  assert.match(source, /panel\.dataset\.hqAutoPaint = String\(ENABLE_HQ_AUTO_PAINT\)/);
});

test("fullscreen editors use the compact floating template panel", () => {
  assert.match(source, /panel\.dataset\.fullscreen = String\(editorFullscreen\(root\)\)/);
  assert.match(source, /\[data-fullscreen="true"\] \{/);
  assert.match(source, /position: fixed;/);
  assert.match(source, /max-height: calc\(100dvh - 6rem\);/);
});

test("HQ templates may be smaller, are positioned without resizing, and persist outside localStorage", () => {
  assert.match(source, /state\.editorKind === "hq"[\s\S]*decodePngSamples/);
  assert.match(source, /header\.width <= expectedWidth && header\.height <= expectedHeight/);
  assert.match(source, /resolveTemplatePosition\([\s\S]*requestedX,[\s\S]*requestedY/);
  assert.match(source, /writeLargeTemplate\(storageKey\(\), file\)/);
  assert.match(source, /readLargeTemplate\(storageKey\(\)\)/);
});

test("HQ UI exposes persistent top-left X/Y coordinates and a center action", () => {
  assert.match(source, /id="\$\{PANEL_ID\}-template-x"/);
  assert.match(source, /id="\$\{PANEL_ID\}-template-y"/);
  assert.match(source, /id="\$\{PANEL_ID\}-template-center"/);
  assert.match(source, /saved\.templateOffsetX/);
  assert.match(source, /saved\.templateOffsetY/);
  assert.match(source, /positionTemplate\(centered\.x, centered\.y\)/);
});

test("HQ coordinates update on input and drag positioning is transactional", () => {
  assert.match(source, /templateX\.addEventListener\("input", applyTemplatePosition\)/);
  assert.match(source, /templateY\.addEventListener\("input", applyTemplatePosition\)/);
  assert.match(source, /id="\$\{PANEL_ID\}-template-move"/);
  assert.match(source, /data-action="confirm"/);
  assert.match(source, /data-action="cancel"/);
  assert.match(source, /templateMoveOriginX = state\.templateOffsetX/);
  assert.match(source, /finishTemplateMoveState\(\);\s*positionTemplate\(x, y\)/);
  assert.match(source, /Template move cancelled; kept X/);
});

test("HQ drag previews avoid rebuilding the full target and intercept paint events", () => {
  assert.match(source, /renderOverlayImage\(\s*state\.templateSource,\s*state\.templateMoveDraftX/);
  assert.match(source, /window\.addEventListener\("pointerdown"[\s\S]*stopImmediatePropagation\(\)/);
  assert.match(source, /queueTemplateMovePreview/);
});

test("the move toolbar lives inside the modal top layer but outside the paint root", () => {
  assert.match(source, /const toolbarHost = state\.root\?\.closest\('\[role="dialog"\], dialog'\) \|\| document\.body/);
  assert.match(source, /toolbarHost\.append\(toolbar\)/);
  assert.match(source, /if \(toolbar\.parentElement !== toolbarHost\) toolbarHost\.append\(toolbar\)/);
  assert.doesNotMatch(source, /document\.querySelector\(`body > \.\$\{MOVE_TOOLBAR_CLASS\}`\)/);
});

test("HQ difference checks compose readable 64-pixel tiles", () => {
  assert.match(source, /function readEditorPixels\(\)/);
  assert.match(source, /state\.tileLayer\.querySelectorAll\("canvas"\)/);
  assert.match(source, /context\.drawImage\(tile, x, y, tile\.width, tile\.height\)/);
});

test("opt-in HQ auto-paint reads the current API charge state, commits, and stops at zero", () => {
  assert.match(source, /async function readHqCharges\(\)/);
  assert.match(source, /https:\/\/backend\.wplace\.live\/alliance\/headquarters/);
  assert.match(source, /state\.paintIntervalEnabled \|\| isHq \? 1 : UNPACED_BATCH_SIZE/);
  assert.match(source, /state\.hqChargesRemaining -= 1/);
  assert.match(source, /await commitPaintSession\(runId\)/);
  assert.match(source, /await refreshHqChargeBudget\(runId\)/);
  assert.match(source, /const hadPendingPixels = paintSessionHasPendingPixels\(\)/);
  assert.match(source, /hadPendingPixels[\s\S]*resolveHqChargeCheckpoint/);
  assert.match(source, /state\.hqChargesRemaining = checkpoint\.nextDispatchBudget/);
  assert.match(source, /if \(checkpoint\.exhausted\)/);
});

test("HQ auto-paint waits for Wplace's rendered tile pixels before its initial queue scan", () => {
  const settle = source.indexOf("await waitForHqTilesToSettle(hqTilesBeforePaint)");
  const queue = source.indexOf("const queue = buildPaintQueue(lockedColor)");

  assert.notEqual(settle, -1);
  assert.notEqual(queue, -1);
  assert.ok(settle < queue);
  assert.match(source, /waitForStableTileSnapshot\(\{/);
  assert.match(source, /requiredChangeFrom: hqTilesBeforePaint/);
  assert.match(source, /getImageData\(0, 0, canvas\.width, canvas\.height\)/);
});

test("HQ paint dispatch mirrors Wplace's stage transform and verifies the round trip", () => {
  assert.match(source, /hqClientPoint\(/);
  assert.match(source, /hqPixelFromClient\(/);
  assert.match(source, /resolved\.x !== item\.x \|\| resolved\.y !== item\.y/);
});
