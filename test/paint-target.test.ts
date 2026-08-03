import assert from "node:assert/strict";
import test from "node:test";

import { shouldQueuePaintPixel } from "../src/core/paint-target.ts";

test("transparent template pixels are painted regardless of wrong-colour repair mode", () => {
  assert.equal(shouldQueuePaintPixel("transparent", false), true);
  assert.equal(shouldQueuePaintPixel("transparent", true), true);
});

test("wrong-colour pixels are queued only when repair is enabled", () => {
  assert.equal(shouldQueuePaintPixel("wrong-colour", false), false);
  assert.equal(shouldQueuePaintPixel("wrong-colour", true), true);
  assert.equal(shouldQueuePaintPixel("matching", true), false);
});
