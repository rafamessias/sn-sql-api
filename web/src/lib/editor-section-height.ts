/** Min-height (px) of the editor stack wrapper; persisted for reload. */
export const EDITOR_SECTION_MIN_HEIGHT_STORAGE_KEY =
  "sn-sql-api:editor-section-min-height-px";

export const EDITOR_SECTION_MIN_HEIGHT_DEFAULT = 260;
export const EDITOR_SECTION_MIN_HEIGHT_STEP = 48;
export const EDITOR_SECTION_MIN_HEIGHT_MIN = 200;

export function editorSectionMinHeightMaxPx(): number {
  if (typeof window === "undefined" || !Number.isFinite(window.innerHeight)) {
    return 1200;
  }
  return Math.round(window.innerHeight * 0.92);
}

export function clampEditorSectionMinHeightPx(n: number): number {
  const max = Math.max(
    EDITOR_SECTION_MIN_HEIGHT_MIN + EDITOR_SECTION_MIN_HEIGHT_STEP,
    editorSectionMinHeightMaxPx(),
  );
  return Math.min(
    Math.max(Math.round(n), EDITOR_SECTION_MIN_HEIGHT_MIN),
    max,
  );
}

export function readEditorSectionMinHeightPxFromStorage(): number {
  if (typeof localStorage === "undefined") {
    return EDITOR_SECTION_MIN_HEIGHT_DEFAULT;
  }
  try {
    const raw = localStorage.getItem(EDITOR_SECTION_MIN_HEIGHT_STORAGE_KEY);
    if (raw == null || raw === "") return EDITOR_SECTION_MIN_HEIGHT_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return EDITOR_SECTION_MIN_HEIGHT_DEFAULT;
    return clampEditorSectionMinHeightPx(parsed);
  } catch {
    return EDITOR_SECTION_MIN_HEIGHT_DEFAULT;
  }
}

export function persistEditorSectionMinHeightPx(n: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EDITOR_SECTION_MIN_HEIGHT_STORAGE_KEY, String(n));
  } catch {
    /* private mode / quota */
  }
}
