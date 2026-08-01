import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_WPLACE_PALETTE,
  colorKey,
  paletteMap,
} from "../src/core/palette.ts";
import {
  paletteButtonForColor,
  readPaletteSwatches,
  selectedPaletteColor,
} from "../src/adapters/wplace-palette.ts";

function fakeButton(rgb: string, label: string, selected: boolean): HTMLButtonElement {
  const classes = new Set(selected ? ["ring-2", "ring-primary", "border-primary"] : []);
  return {
    style: { backgroundColor: rgb },
    dataset: {},
    classList: { contains: (name: string) => classes.has(name) },
    hasAttribute: (name: string) => name === "aria-pressed",
    getAttribute: (name: string) => {
      if (name === "aria-label") return label;
      if (name === "aria-pressed") return selected ? "true" : "false";
      return null;
    },
  } as unknown as HTMLButtonElement;
}

function fakeRoot(buttons: readonly HTMLButtonElement[]): HTMLElement {
  const container = { querySelectorAll: () => buttons };
  return { closest: () => container } as unknown as HTMLElement;
}

test("the live Wplace palette keeps the current Teal RGB", () => {
  const colors = paletteMap(CURRENT_WPLACE_PALETTE);
  assert.equal(colors.get("16,174,166")?.name, "Teal");
  assert.equal(colors.has("16,174,130"), false);
});

test("selected color comes from exact swatch RGB, independent of visibility or label lookup", () => {
  const teal = fakeButton("rgb(16, 174, 166)", "Teal renamed tomorrow", true);
  const root = fakeRoot([teal]);
  const selected = selectedPaletteColor(root);

  assert.equal(colorKey(selected!), "16,174,166");
  assert.equal(selected?.name, "Teal renamed tomorrow");
  assert.equal(readPaletteSwatches(root).length, 1);
  assert.equal(paletteButtonForColor(root, selected!), teal);
});
