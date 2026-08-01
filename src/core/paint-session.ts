export const ALLIANCE_EDITOR_RECYCLE_EVENTS = 2_500;

export interface EditorRecycleState {
  dispatchedSinceRecycle: number;
  intervalEnabled: boolean;
  queueRemaining: number;
}

export function shouldRecycleAllianceEditor({
  dispatchedSinceRecycle,
  intervalEnabled,
  queueRemaining,
}: EditorRecycleState): boolean {
  return !intervalEnabled
    && queueRemaining > 0
    && dispatchedSinceRecycle >= ALLIANCE_EDITOR_RECYCLE_EVENTS;
}
