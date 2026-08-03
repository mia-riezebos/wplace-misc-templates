import assert from "node:assert/strict";
import test from "node:test";

import {
  editorInputKind,
  isFullscreenEditorClassName,
  isSyntheticPointerCaptureError,
  isWplacePaintButtonLabel,
  settlePaintSessionActivation,
} from "../src/core/editor-session.ts";

test("Wplace Paint buttons may include a live cooldown", () => {
  assert.equal(isWplacePaintButtonLabel("Paint"), true);
  assert.equal(isWplacePaintButtonLabel("Paint (0:25)"), true);
  assert.equal(isWplacePaintButtonLabel(" Auto-paint "), false);
  assert.equal(isWplacePaintButtonLabel("Painted pixels"), false);
});

test("profile drafts use click input while canvas editors use pointer strokes", () => {
  assert.equal(editorInputKind("profile"), "profile");
  assert.equal(editorInputKind("alliance"), "pointer");
  assert.equal(editorInputKind("hq"), "pointer");
});

test("synthetic pointer capture only suppresses the expected Chrome error", () => {
  assert.equal(isSyntheticPointerCaptureError("NotFoundError", 9471, 9471), true);
  assert.equal(isSyntheticPointerCaptureError("InvalidStateError", 9471, 9471), false);
  assert.equal(isSyntheticPointerCaptureError("NotFoundError", 1, 9471), false);
});

test("Wplace fullscreen stages are recognized from their current class contract", () => {
  assert.equal(
    isFullscreenEditorClassName("stage !absolute !inset-0 min-h-0 !rounded-none"),
    true,
  );
  assert.equal(isFullscreenEditorClassName("stage mt-3 min-h-72 grow"), false);
});

test("a newly opened paint session settles before the first unpaced batch", async () => {
  let frame = 0;
  let inputHandlersReady = false;

  const active = await settlePaintSessionActivation(
    async () => {
      frame += 1;
      if (frame === 2) inputHandlersReady = true;
    },
    () => true,
  );

  let accepted = 0;
  for (let dispatched = 0; dispatched < 100; dispatched += 1) {
    if (inputHandlersReady) accepted += 1;
  }

  assert.equal(active, true);
  assert.equal(accepted, 100);
});
