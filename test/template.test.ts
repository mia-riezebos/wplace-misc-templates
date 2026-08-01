import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_WPLACE_PALETTE,
  colorKey,
} from "../src/core/palette.ts";
import {
  resolveEditorColor,
  validateTemplatePixels,
} from "../src/core/template.ts";

function onePixel(red: number, green: number, blue: number, alpha = 255) {
  return { width: 1, height: 1, data: new Uint8ClampedArray([red, green, blue, alpha]) };
}

test("alliance templates translate Ditherette Teal to the live Wplace palette slot", () => {
  assert.equal(
    validateTemplatePixels(onePixel(16, 174, 166), "alliance", CURRENT_WPLACE_PALETTE),
    null,
  );
  assert.equal(
    validateTemplatePixels(onePixel(16, 174, 130), "alliance", CURRENT_WPLACE_PALETTE),
    null,
  );
  assert.equal(
    colorKey(resolveEditorColor("alliance", CURRENT_WPLACE_PALETTE, 16, 174, 130)!),
    "16,174,166",
  );

  const changedLivePalette = [...CURRENT_WPLACE_PALETTE];
  changedLivePalette[25] = { name: "Renamed Teal", rgb: [1, 2, 3] };
  assert.equal(
    colorKey(resolveEditorColor("alliance", changedLivePalette, 16, 174, 130)!),
    "1,2,3",
  );
});

test("alliance templates still reject colors outside the template palette", () => {
  assert.match(
    validateTemplatePixels(onePixel(1, 2, 3), "alliance", CURRENT_WPLACE_PALETTE) || "",
    /not a supported Wplace template color/,
  );
});

test("profile templates retain arbitrary opaque RGB support", () => {
  assert.equal(
    validateTemplatePixels(onePixel(1, 2, 3), "profile", CURRENT_WPLACE_PALETTE),
    null,
  );
});
