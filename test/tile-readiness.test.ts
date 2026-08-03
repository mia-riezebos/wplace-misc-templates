import assert from "node:assert/strict";
import test from "node:test";

import { waitForStableTileSnapshot } from "../src/core/tile-readiness.ts";

test("HQ queue construction waits past a stale first tile snapshot", async () => {
  const signatures = ["stale", "stale", "stale", "fresh", "fresh", "fresh"];
  let index = 0;

  const result = await waitForStableTileSnapshot({
    readSignature: () => signatures[Math.min(index, signatures.length - 1)]!,
    wait: async () => {
      index += 1;
    },
    minimumSamples: 4,
    stableSamples: 3,
    maximumSamples: 10,
  });

  assert.deepEqual(result, {
    signature: "fresh",
    samples: 6,
    stable: true,
  });
});

test("an unavailable tile snapshot never counts as ready", async () => {
  const result = await waitForStableTileSnapshot({
    readSignature: () => null,
    wait: async () => {},
    minimumSamples: 2,
    stableSamples: 2,
    maximumSamples: 3,
  });

  assert.deepEqual(result, {
    signature: null,
    samples: 3,
    stable: false,
  });
});

test("opening HQ Paint must observe a tile transition before accepting a stable snapshot", async () => {
  const signatures = [
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "pre-paint",
    "paint-ready",
    "paint-ready",
    "paint-ready",
  ];
  let index = 0;

  const result = await waitForStableTileSnapshot({
    readSignature: () => signatures[Math.min(index, signatures.length - 1)]!,
    wait: async () => {
      index += 1;
    },
    requiredChangeFrom: "pre-paint",
    minimumSamples: 6,
    stableSamples: 3,
    maximumSamples: 12,
  });

  assert.deepEqual(result, {
    signature: "paint-ready",
    samples: 11,
    stable: true,
  });
});
