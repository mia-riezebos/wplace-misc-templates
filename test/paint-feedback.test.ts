import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshMismatchOverlay } from "../src/core/paint-feedback.ts";

test("an active auto-paint stream schedules no full-canvas overlay refreshes", () => {
  let refreshes = 0;
  for (let index = 0; index < 23_831; index += 1) {
    if (shouldRefreshMismatchOverlay({
      mismatchesOnly: true,
      paintActive: true,
      pointerId: 9_471,
      syntheticPointerId: 9_471,
    })) refreshes += 1;
  }
  assert.equal(refreshes, 0);
});

test("an idle human paint can refresh the differences overlay", () => {
  assert.equal(shouldRefreshMismatchOverlay({
    mismatchesOnly: true,
    paintActive: false,
    pointerId: 1,
    syntheticPointerId: 9_471,
  }), true);
});
