import assert from "node:assert/strict";
import test from "node:test";

import {
  hqClientPoint,
  hqPixelFromClient,
} from "../src/core/hq-coordinates.ts";

test("HQ client coordinates round-trip through Wplace's stage transform", () => {
  const viewport = {
    rootLeft: 206,
    rootTop: 430.25,
    scale: 0.913835,
    translateX: -1172.35,
    translateY: 205.02,
  };

  const client = hqClientPoint({ x: 1785, y: 128 }, viewport);
  assert.deepEqual(hqPixelFromClient(client, viewport), { x: 1785, y: 128 });
  assert.ok(Math.abs(client.x - 665.3023925) < 0.001);
  assert.ok(Math.abs(client.y - 752.6977975) < 0.001);
});
