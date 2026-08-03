export type ExistingPixelDisposition = "transparent" | "matching" | "wrong-colour";

export function shouldQueuePaintPixel(
  disposition: ExistingPixelDisposition,
  fixWrongColors: boolean,
): boolean {
  return disposition === "transparent"
    || (disposition === "wrong-colour" && fixWrongColors);
}
