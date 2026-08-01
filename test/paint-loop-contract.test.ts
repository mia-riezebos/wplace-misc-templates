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

test("unpaced auto-paint recycles Wplace's editor state and stops stale batches", () => {
  assert.match(autoPaintLoop, /shouldRecycleAllianceEditor\(/);
  assert.match(autoPaintLoop, /recycleAllianceEditor\(runId\)/);
  assert.match(source, /naturalRefreshDeadline[\s\S]*state\.root !== recycleRoot/);
  assert.match(source, /recycleRoot = state\.root[\s\S]*editorChromeDeadline/);
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
