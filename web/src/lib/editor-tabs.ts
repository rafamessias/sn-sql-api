export type EditorTab = {
  id: string;
  name: string;
  query: string;
  /** Wall-clock duration (ms) of the last successful Run, persisted with the tab. */
  lastRunDurationMs?: number;
  /** Last successful Table API run — browser round-trip (ms), persisted with the tab. */
  lastTableApiBrowserMs?: number;
  /** Last successful Table API run — API→ServiceNow call duration (ms), persisted with the tab. */
  lastTableApiInstanceMs?: number;
  /** When true, show split JDBC + Table API editor for this tab (persisted). */
  compareTableApi?: boolean;
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
    const browserRaw = obj.lastTableApiBrowserMs;
    const instanceRaw = obj.lastTableApiInstanceMs;
    const lastTableApiBrowserMs =
      typeof browserRaw === "number" &&
      Number.isFinite(browserRaw) &&
      browserRaw >= 0 &&
      browserRaw <= 86_400_000
        ? Math.round(browserRaw)
        : undefined;
    const lastTableApiInstanceMs =
      typeof instanceRaw === "number" &&
      Number.isFinite(instanceRaw) &&
      instanceRaw >= 0 &&
      instanceRaw <= 86_400_000
        ? Math.round(instanceRaw)
        : undefined;

    const cr = obj.compareTableApi;
    const compareTableApi =
      cr === true ? true : cr === false ? false : undefined;

    const tab: EditorTab = { id, name, query };
    if (lastRunDurationMs !== undefined) {
      tab.lastRunDurationMs = lastRunDurationMs;
    }
    if (
      lastTableApiBrowserMs !== undefined &&
      lastTableApiInstanceMs !== undefined
    ) {
      tab.lastTableApiBrowserMs = lastTableApiBrowserMs;
      tab.lastTableApiInstanceMs = lastTableApiInstanceMs;
    }
    if (compareTableApi !== undefined) {
      tab.compareTableApi = compareTableApi;
    }
    out.push(tab);
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
