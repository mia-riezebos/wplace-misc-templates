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
