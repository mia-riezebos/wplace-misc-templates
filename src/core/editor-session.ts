export type EditorInputKind = "profile" | "pointer";

export function isWplacePaintButtonLabel(label: string | null | undefined): boolean {
  return /^Paint(?:\s*\([^)]*\))?$/.test(label?.trim() ?? "");
}

export function editorInputKind(editorKind: string): EditorInputKind {
  return editorKind === "profile" ? "profile" : "pointer";
}

