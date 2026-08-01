export interface OverlayRefreshContext {
  readonly mismatchesOnly: boolean;
  readonly paintActive: boolean;
  readonly pointerId: number;
  readonly syntheticPointerId: number;
}

export function shouldRefreshMismatchOverlay({
  mismatchesOnly,
  paintActive,
  pointerId,
  syntheticPointerId,
}: OverlayRefreshContext): boolean {
  return mismatchesOnly && !paintActive && pointerId !== syntheticPointerId;
}
