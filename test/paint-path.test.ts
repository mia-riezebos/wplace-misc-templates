import assert from "node:assert/strict";
import test from "node:test";
import type { Color } from "../src/core/palette.ts";
import { orderPaintItems } from "../src/core/paint-path.ts";

const color: Color = { name: "test", rgb: [0, 0, 0] };
const item = (x: number, y: number) => ({ x, y, color });
const coordinates = (items: readonly { x: number; y: number }[]) => (
  items.map(({ x, y }) => `${x},${y}`)
);

test("linear and zigzag paths are deterministic", () => {
  const source = [item(0, 1), item(2, 0), item(0, 0), item(2, 1), item(1, 0), item(1, 1)];
  assert.deepEqual(coordinates(orderPaintItems(source, "start-end", 3, 2)), [
    "0,0", "1,0", "2,0", "0,1", "1,1", "2,1",
  ]);
  assert.deepEqual(coordinates(orderPaintItems(source, "end-start", 3, 2)), [
    "2,1", "1,1", "0,1", "2,0", "1,0", "0,0",
  ]);
  assert.deepEqual(coordinates(orderPaintItems(source, "zigzag", 3, 2)), [
    "0,0", "1,0", "2,0", "2,1", "1,1", "0,1",
  ]);
});

test("middle-out and edge-in prioritize the requested spatial region", () => {
  const source = [item(0, 0), item(2, 2), item(1, 1), item(0, 1), item(1, 0)];
  assert.equal(coordinates(orderPaintItems(source, "middle-out", 3, 3))[0], "1,1");
  assert.equal(coordinates(orderPaintItems(source, "edge-in", 3, 3)).at(-1), "1,1");
});

test("Hilbert path visits every square cell through adjacent steps", () => {
  const source = Array.from({ length: 4 }, (_, y) => (
    Array.from({ length: 4 }, (_, x) => item(x, y))
  )).flat();
  const ordered = orderPaintItems(source, "hilbert", 4, 4);
  assert.equal(new Set(coordinates(ordered)).size, 16);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    assert.equal(Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y), 1);
  }
});
