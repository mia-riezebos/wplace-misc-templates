import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLIANCE_EDITOR_RECYCLE_EVENTS,
  shouldRecycleAllianceEditor,
} from "../src/core/paint-session.ts";

test("unpaced alliance auto-paint recycles after a bounded event burst", () => {
  assert.equal(shouldRecycleAllianceEditor({
    dispatchedSinceRecycle: ALLIANCE_EDITOR_RECYCLE_EVENTS - 1,
    intervalEnabled: false,
    queueRemaining: 1,
  }), false);
  assert.equal(shouldRecycleAllianceEditor({
    dispatchedSinceRecycle: ALLIANCE_EDITOR_RECYCLE_EVENTS,
    intervalEnabled: false,
    queueRemaining: 1,
  }), true);
});

test("paced and completed queues never recycle the editor", () => {
  assert.equal(shouldRecycleAllianceEditor({
    dispatchedSinceRecycle: ALLIANCE_EDITOR_RECYCLE_EVENTS,
    intervalEnabled: true,
    queueRemaining: 1,
  }), false);
  assert.equal(shouldRecycleAllianceEditor({
    dispatchedSinceRecycle: ALLIANCE_EDITOR_RECYCLE_EVENTS,
    intervalEnabled: false,
    queueRemaining: 0,
  }), false);
});
