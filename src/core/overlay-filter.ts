export function templatePixelMatchesSelectedColor(
  red: number,
  green: number,
  blue: number,
  selectedRgb: readonly [number, number, number] | null,
): boolean {
  return selectedRgb !== null
    && red === selectedRgb[0]
    && green === selectedRgb[1]
    && blue === selectedRgb[2];
}
