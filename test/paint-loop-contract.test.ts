import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const start = source.indexOf("  async function startAutoFill()");
const end = source.indexOf("\n  function syncControls()", start);
const autoPaintLoop = source.slice(start, end);

test("alliance auto-paint scans once to build its queue and never checks during dispatch", () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.equal(autoPaintLoop.match(/buildPaintQueue\(/g)?.length, 1);
  assert.doesNotMatch(
    autoPaintLoop,
    /canvasPixelDisposition|canvasBatchDispositions|waitForCanvas|getImageData|renderOverlay/,
  );
});

test("auto-paint starts without a confirmation dialog", () => {
  assert.doesNotMatch(autoPaintLoop, /window\.confirm/);
});

test("unpaced auto-paint commits and reopens its Wplace session after 7,000 events", () => {
  assert.match(autoPaintLoop, /shouldRecycleAllianceEditor\(\{/);
  assert.match(autoPaintLoop, /dispatchedSinceRecycle \+= result\.dispatched/);
  assert.match(autoPaintLoop, /commitPaintSession\(runId\)/);
  assert.match(autoPaintLoop, /ensurePaintTool\(runId\)/);
  assert.match(autoPaintLoop, /let paintEditorRoot = state\.root/);
  assert.match(autoPaintLoop, /state\.root !== paintEditorRoot/);
  assert.match(autoPaintLoop, /reopenAllianceEditorAfterRefresh\(runId, state\.root\)/);
  assert.match(source, /async function reopenAllianceEditorAfterRefresh\(runId, refreshedRoot\)/);
  assert.match(source, /visibleEnabledButtons\(dialog, "Back"\)[\s\S]*backButton\.click\(\)/);
  assert.match(source, /button\.getAttribute\("aria-label"\) === label/);
  assert.match(source, /Continue painting[\s\S]*state\.root !== recycleRoot/);
  assert.match(autoPaintLoop, /if \(result\.refreshed\) continue;/);
  assert.match(source, /panel\.dataset\.version = SCRIPT_VERSION/);

  const dispatchStart = source.indexOf("  async function dispatchPaintBatch(");
  const dispatchEnd = source.indexOf("\n  function syncPaintControls()", dispatchStart);
  const dispatchLoop = source.slice(dispatchStart, dispatchEnd);
  const staleRunCheck = dispatchLoop.indexOf("runId !== state.paintRunId");
  const paintDispatch = dispatchLoop.indexOf("dispatchPaintEvents(item)");

  assert.notEqual(staleRunCheck, -1);
  assert.notEqual(paintDispatch, -1);
  assert.ok(staleRunCheck < paintDispatch);
});

test("alliance and HQ auto-paint commit Wplace's pending session before completing", () => {
  assert.match(autoPaintLoop, /await commitPaintSession\(runId\)/);
  assert.match(source, /function paintSessionActive\(\)/);
  assert.match(source, /async function commitPaintSession\(runId\)/);
});

test("profile draft fill dispatches the click event Wplace now listens for", () => {
  assert.match(source, /editorInputKind\(state\.editorKind\) === "profile"/);
  assert.match(source, /new pageWindow\.MouseEvent\("click"/);
});

test("canvas auto-paint bridges synthetic pointer capture in Wplace's page realm", () => {
  assert.match(source, /function installSyntheticPointerCaptureBridge\(\)/);
  assert.match(source, /pageWindow\.Element\?\.prototype/);
  assert.match(source, /new pageWindow\.PointerEvent\("pointerdown"/);
  assert.match(source, /installSyntheticPointerCaptureBridge\(\)/);
});

test("selected-color auto-paint opens Wplace's new session before reading its swatch", () => {
  const sessionStart = autoPaintLoop.indexOf("!isProfile && !await ensurePaintTool()");
  const selectedColorRead = autoPaintLoop.indexOf("readSelectedPaletteColor(state.root)");
  assert.notEqual(sessionStart, -1);
  assert.notEqual(selectedColorRead, -1);
  assert.ok(sessionStart < selectedColorRead);
});

test("new Wplace paint sessions settle before their first dispatched batch", () => {
  const ensureStart = source.indexOf("  async function ensurePaintTool(");
  const ensureEnd = source.indexOf("\n  async function commitPaintSession", ensureStart);
  const ensurePaintTool = source.slice(ensureStart, ensureEnd);

  assert.match(ensurePaintTool, /waitForPaintSession\(true, runId\)/);
  assert.match(ensurePaintTool, /settlePaintSessionActivation\(/);
});

test("stopping auto-paint submits pixels already pending in Wplace's session", () => {
  assert.match(source, /async function stopAndCommitAutoFill\(\)/);
  assert.match(source, /const committed = await commitPaintSession\(runId\)/);
  assert.match(source, /void stopAndCommitAutoFill\(\)/);
});
