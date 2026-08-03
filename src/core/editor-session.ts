export type EditorInputKind = "profile" | "pointer";

export function isWplacePaintButtonLabel(label: string | null | undefined): boolean {
  return /^Paint(?:\s*\([^)]*\))?$/.test(label?.trim() ?? "");
}

export function isSyntheticPointerCaptureError(
  errorName: string | null | undefined,
  pointerId: number,
  syntheticPointerId: number,
): boolean {
  return pointerId === syntheticPointerId && errorName === "NotFoundError";
}

export function isFullscreenEditorClassName(className: string | null | undefined): boolean {
  return (className ?? "").split(/\s+/).includes("!inset-0");
}

export function editorInputKind(editorKind: string): EditorInputKind {
  return editorKind === "profile" ? "profile" : "pointer";
}

export async function settlePaintSessionActivation(
  nextFrame: () => Promise<unknown>,
  isActive: () => boolean,
): Promise<boolean> {
  // Wplace exposes the active paint controls before the HQ artboard's pointer
  // handlers and layout are guaranteed to have settled. Two frames keep an
  // unpaced first batch from racing that React commit.
  await nextFrame();
  await nextFrame();
  return isActive();
}
