import type { Color } from "./palette.ts";

export const PAINT_PATHS = [
  "start-end",
  "end-start",
  "middle-out",
  "edge-in",
  "zigzag",
  "hilbert",
] as const;

export type PaintPath = typeof PAINT_PATHS[number];

export interface PaintItem {
  readonly x: number;
  readonly y: number;
  readonly color: Color;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function rotate(size: number, x: number, y: number, right: number, up: number): [number, number] {
  if (up !== 0) return [x, y];
  const rotatedX = right === 1 ? size - 1 - x : y;
  const rotatedY = right === 1 ? size - 1 - y : x;
  return right === 1 ? [rotatedY, rotatedX] : [rotatedX, rotatedY];
}

export function hilbertIndex(x: number, y: number, size: number): number {
  let distance = 0;
  let currentX = x;
  let currentY = y;
  for (let scale = size / 2; scale >= 1; scale /= 2) {
    const right = (currentX & scale) > 0 ? 1 : 0;
    const up = (currentY & scale) > 0 ? 1 : 0;
    distance += scale * scale * ((3 * right) ^ up);
    [currentX, currentY] = rotate(scale, currentX, currentY, right, up);
  }
  return distance;
}

export function orderPaintItems(
  items: readonly PaintItem[],
  path: PaintPath,
  width: number,
  height: number,
): PaintItem[] {
  const ordered = [...items];
  const rowMajor = (left: PaintItem, right: PaintItem) => left.y - right.y || left.x - right.x;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;

  switch (path) {
    case "start-end":
      return ordered.sort(rowMajor);
    case "end-start":
      return ordered.sort((left, right) => -rowMajor(left, right));
    case "middle-out":
      return ordered.sort((left, right) => {
        const leftDistance = (left.x - centerX) ** 2 + (left.y - centerY) ** 2;
        const rightDistance = (right.x - centerX) ** 2 + (right.y - centerY) ** 2;
        return leftDistance - rightDistance || rowMajor(left, right);
      });
    case "edge-in":
      return ordered.sort((left, right) => {
        const leftEdge = Math.min(left.x, left.y, width - 1 - left.x, height - 1 - left.y);
        const rightEdge = Math.min(right.x, right.y, width - 1 - right.x, height - 1 - right.y);
        return leftEdge - rightEdge || rowMajor(left, right);
      });
    case "zigzag":
      return ordered.sort((left, right) => (
        left.y - right.y || (left.y % 2 === 0 ? left.x - right.x : right.x - left.x)
      ));
    case "hilbert": {
      const size = nextPowerOfTwo(Math.max(width, height));
      return ordered.sort((left, right) => (
        hilbertIndex(left.x, left.y, size) - hilbertIndex(right.x, right.y, size)
        || rowMajor(left, right)
      ));
    }
  }
}
