export type PixelPoint = {
  x: number;
  y: number;
};

export type HqStageViewport = {
  rootLeft: number;
  rootTop: number;
  scale: number;
  translateX: number;
  translateY: number;
};

export function hqClientPoint(
  pixel: PixelPoint,
  viewport: HqStageViewport,
): PixelPoint {
  return {
    x: viewport.rootLeft + viewport.translateX + (pixel.x + 0.5) * viewport.scale,
    y: viewport.rootTop + viewport.translateY + (pixel.y + 0.5) * viewport.scale,
  };
}

export function hqPixelFromClient(
  client: PixelPoint,
  viewport: HqStageViewport,
): PixelPoint {
  return {
    x: Math.floor((client.x - viewport.rootLeft - viewport.translateX) / viewport.scale),
    y: Math.floor((client.y - viewport.rootTop - viewport.translateY) / viewport.scale),
  };
}
