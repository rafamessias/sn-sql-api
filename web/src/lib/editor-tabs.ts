export type EditorTab = {
  id: string;
  name: string;
  query: string;
  /** Wall-clock duration (ms) of the last successful Run, persisted with the tab. */
  lastRunDurationMs?: number;
};

export const STORAGE_KEYS = {
  tabs: "sn-sql-api:editorTabs:v1",
  activeId: "sn-sql-api:editorTabs:activeId",
} as const;

export const LEGACY_QUERY_KEY = "sn-sql-api:lastQuery";

export const DEFAULT_QUERY =
  "SELECT number, short_description, sys_created_on FROM incident LIMIT 100";

export const generateTabId = (): string =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const defaultTab = (): EditorTab => ({
  id: generateTabId(),
  name: "Query 1",
  query: DEFAULT_QUERY,
});

export const sanitizeTabs = (raw: unknown): EditorTab[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: EditorTab[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id =
      typeof obj.id === "string" && obj.id.trim() ? obj.id : generateTabId();
    const name =
      typeof obj.name === "string" && obj.name.trim() ? obj.name : "Query";
    const query = typeof obj.query === "string" ? obj.query : "";
    const lastRaw = obj.lastRunDurationMs;
    const lastRunDurationMs =
      typeof lastRaw === "number" &&
      Number.isFinite(lastRaw) &&
      lastRaw >= 0 &&
      lastRaw <= 86_400_000
        ? Math.round(lastRaw)
        : undefined;
    out.push(
      lastRunDurationMs !== undefined
        ? { id, name, query, lastRunDurationMs }
        : { id, name, query },
    );
  }
  return out;
};

/**
 * Best-effort derivation of a tab name from a SQL string. Picks the first
 * table referenced after FROM, falls back to "Query" when nothing matches.
 */
export const deriveTabName = (sql: string): string => {
  if (!sql) return "Query";
  const match = sql.match(/\bfrom\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/i);
  if (match && match[1]) {
    return match[1];
  }
  return "Query";
};
