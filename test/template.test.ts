import assert from "node:assert/strict";
import test from "node:test";
import { CURRENT_WPLACE_PALETTE } from "../src/core/palette.ts";
import { validateTemplatePixels } from "../src/core/template.ts";

function onePixel(red: number, green: number, blue: number, alpha = 255) {
  return { width: 1, height: 1, data: new Uint8ClampedArray([red, green, blue, alpha]) };
}

test("alliance templates accept current Teal and reject the stale Teal that cannot be painted", () => {
  assert.equal(
    validateTemplatePixels(onePixel(16, 174, 166), "alliance", CURRENT_WPLACE_PALETTE),
    null,
  );
  assert.match(
    validateTemplatePixels(onePixel(16, 174, 130), "alliance", CURRENT_WPLACE_PALETTE) || "",
    /not a current Wplace palette color/,
  );
});

test("profile templates retain arbitrary opaque RGB support", () => {
  assert.equal(
    validateTemplatePixels(onePixel(1, 2, 3), "profile", CURRENT_WPLACE_PALETTE),
    null,
  );
});
