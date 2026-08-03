import assert from "node:assert/strict";
import test from "node:test";

import { resolveHqChargeCheckpoint } from "../src/core/hq-charge.ts";

test("HQ charge checkpoints continue after Wplace accepts only part of a dispatched batch", () => {
  let serverCharges = 100;
  let dispatchBudget = 100;
  let checkpoints = 0;

  while (serverCharges > 0 && checkpoints < 20) {
    const accepted = Math.max(1, Math.ceil(dispatchBudget * 0.32));
    serverCharges = Math.max(0, serverCharges - accepted);
    const checkpoint = resolveHqChargeCheckpoint(serverCharges);
    checkpoints += 1;
    if (checkpoint.exhausted) break;
    dispatchBudget = checkpoint.nextDispatchBudget;
  }

  assert.equal(serverCharges, 0);
  assert.ok(checkpoints > 1, "the 100-event dispatch must not be treated as 100 accepted paints");
});

test("HQ charge checkpoints stop only when Wplace reports no charges", () => {
  assert.deepEqual(resolveHqChargeCheckpoint(48), {
    exhausted: false,
    nextDispatchBudget: 48,
  });
  assert.deepEqual(resolveHqChargeCheckpoint(0), {
    exhausted: true,
    nextDispatchBudget: 0,
  });
});
