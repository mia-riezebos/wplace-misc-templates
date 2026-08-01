import {
  CURRENT_WPLACE_PALETTE,
  type Color,
  colorFromRgb,
  colorKey,
  parseCssRgb,
} from "../core/palette.ts";

export interface PaletteSwatch {
  readonly button: HTMLButtonElement;
  readonly color: Color;
  readonly selected: boolean;
}

function paletteContainer(root: HTMLElement | null): ParentNode {
  return root?.closest('[role="dialog"], dialog') || document;
}

function isSelected(button: HTMLButtonElement): boolean {
  return button.getAttribute("aria-pressed") === "true"
    || button.dataset.state === "active"
    || button.dataset.selected === "true"
    || (button.classList.contains("ring-2")
      && (button.classList.contains("ring-primary") || button.classList.contains("border-primary")));
}

export function readPaletteSwatches(root: HTMLElement | null): readonly PaletteSwatch[] {
  return [...paletteContainer(root).querySelectorAll<HTMLButtonElement>("button[aria-label]")]
    .flatMap((button) => {
      const rgb = parseCssRgb(button.style.backgroundColor);
      if (!rgb) return [];
      return [{
        button,
        color: colorFromRgb(rgb, button.getAttribute("aria-label")),
        selected: isSelected(button),
      }];
    });
}

export function alliancePalette(root: HTMLElement | null): readonly Color[] {
  const live = readPaletteSwatches(root).map(({ color }) => color);
  return live.length ? live : CURRENT_WPLACE_PALETTE;
}

export function selectedPaletteColor(root: HTMLElement | null): Color | null {
  return readPaletteSwatches(root).find(({ selected }) => selected)?.color || null;
}

export function paletteButtonForColor(root: HTMLElement | null, color: Color): HTMLButtonElement | null {
  return readPaletteSwatches(root).find((swatch) => colorKey(swatch.color) === colorKey(color))?.button || null;
}
