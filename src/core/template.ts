import {
  type Color,
  type Rgb,
  colorFromRgb,
  liveColorForTemplateRgb,
} from "./palette.ts";

export type EditorKind = "alliance" | "hq" | "profile";

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface TemplatePosition {
  readonly x: number;
  readonly y: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function resolveTemplatePosition(
  canvasWidth: number,
  canvasHeight: number,
  templateWidth: number,
  templateHeight: number,
  requestedX?: number,
  requestedY?: number,
): TemplatePosition {
  const maxX = Math.max(0, canvasWidth - templateWidth);
  const maxY = Math.max(0, canvasHeight - templateHeight);
  const centerX = Math.floor(maxX / 2);
  const centerY = Math.floor(maxY / 2);
  const x = Number.isFinite(requestedX) ? Math.trunc(requestedX!) : centerX;
  const y = Number.isFinite(requestedY) ? Math.trunc(requestedY!) : centerY;
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
    maxX,
    maxY,
  };
}

export function resolveEditorColor(
  kind: EditorKind,
  liveColors: readonly Color[],
  red: number,
  green: number,
  blue: number,
): Color | null {
  const rgb = [red, green, blue] as Rgb;
  return kind === "profile"
    ? colorFromRgb(rgb)
    : liveColorForTemplateRgb(liveColors, rgb);
}

export function validateTemplatePixels(
  image: PixelImage,
  kind: EditorKind,
  colors: readonly Color[],
): string | null {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.data[index + 3] ?? 0;
      if (alpha === 0) continue;
      if (alpha !== 255) {
        return `Pixel ${x}, ${y} is partially transparent; use only fully transparent or opaque pixels.`;
      }
      const red = image.data[index] ?? 0;
      const green = image.data[index + 1] ?? 0;
      const blue = image.data[index + 2] ?? 0;
      if (kind !== "profile" && !resolveEditorColor(kind, colors, red, green, blue)) {
        return `Pixel ${x}, ${y} uses rgb(${red}, ${green}, ${blue}), which is not a supported Wplace template color.`;
      }
    }
  }
  return null;
}
