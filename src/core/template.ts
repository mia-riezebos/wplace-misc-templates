import {
  type Color,
  type Rgb,
  colorFromRgb,
  paletteMap,
} from "./palette.ts";

export type EditorKind = "alliance" | "profile";

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export function resolveEditorColor(
  kind: EditorKind,
  palette: ReadonlyMap<string, Color>,
  red: number,
  green: number,
  blue: number,
): Color | null {
  const exact = palette.get(`${red},${green},${blue}`);
  if (exact) return exact;
  return kind === "profile" ? colorFromRgb([red, green, blue] as Rgb) : null;
}

export function validateTemplatePixels(
  image: PixelImage,
  kind: EditorKind,
  colors: readonly Color[],
): string | null {
  const palette = paletteMap(colors);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.data[index + 3];
      if (alpha === 0) continue;
      if (alpha !== 255) {
        return `Pixel ${x}, ${y} is partially transparent; use only fully transparent or opaque pixels.`;
      }
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      const rgb = `${red},${green},${blue}`;
      if (kind === "alliance" && !palette.has(rgb)) {
        return `Pixel ${x}, ${y} uses rgb(${rgb.replaceAll(",", ", ")}), which is not a current Wplace palette color.`;
      }
    }
  }
  return null;
}
