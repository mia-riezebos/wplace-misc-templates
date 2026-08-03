import assert from "node:assert/strict";
import test from "node:test";

import {
  editorInputKind,
  isWplacePaintButtonLabel,
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
