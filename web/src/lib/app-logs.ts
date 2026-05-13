export type AppLogLevel = "info" | "success" | "warn" | "error";

export type AppLogEntry = {
  id: string;
  ts: number;
  level: AppLogLevel;
  category: string;
  message: string;
  detail?: string;
};

const STORAGE_KEY = "sn-sql-api-console-logs-v1";
const MAX_ENTRIES = 800;

const LOG_LEVELS: readonly AppLogLevel[] = [
  "info",
  "success",
  "warn",
  "error",
];

const isLogLevel = (x: unknown): x is AppLogLevel =>
  typeof x === "string" && (LOG_LEVELS as readonly string[]).includes(x);

/** Drop JDBC driver lines from log detail (never show in UI / exports). */
const DRIVER_DETAIL_LINE = /^driver:\s*/i;

const sanitizeDetail = (detail: string | undefined): string | undefined => {
  if (detail === undefined || detail === "") return undefined;
  const kept = detail
    .split("\n")
    .filter((line) => !DRIVER_DETAIL_LINE.test(line.trim()));
  const joined = kept.join("\n").trim();
  return joined === "" ? undefined : joined;
};

const entryWithSanitizedDetail = (
  e: AppLogEntry,
): { entry: AppLogEntry; changed: boolean } => {
  const nextDetail = sanitizeDetail(e.detail);
  if (nextDetail === e.detail) return { entry: e, changed: false };
  if (nextDetail === undefined) {
    const { detail: _d, ...rest } = e;
    return { entry: rest as AppLogEntry, changed: true };
  }
  return { entry: { ...e, detail: nextDetail }, changed: true };
};

const parseEntry = (item: unknown): AppLogEntry | null => {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.ts !== "number") return null;
  if (!isLogLevel(o.level)) return null;
  if (typeof o.category !== "string" || typeof o.message !== "string")
    return null;
  const detailRaw = o.detail;
  const detail =
    detailRaw === undefined || detailRaw === null
      ? undefined
      : typeof detailRaw === "string"
        ? detailRaw
        : String(detailRaw);
  return {
    id: o.id,
    ts: o.ts,
    level: o.level,
    category: o.category,
    message: o.message,
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  };
};

const parseStoredLogs = (
  raw: string,
  opts?: { rewriteDiskIfSanitized?: boolean },
): AppLogEntry[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: AppLogEntry[] = [];
    let anySanitized = false;
    for (const item of parsed) {
      const e = parseEntry(item);
      if (!e) continue;
      if (e.category === "Connect") {
        anySanitized = true;
        continue;
      }
      const { entry, changed } = entryWithSanitizedDetail(e);
      if (changed) anySanitized = true;
      out.push(entry);
    }
    const sliced = out.slice(0, MAX_ENTRIES);
    if (
      opts?.rewriteDiskIfSanitized &&
      anySanitized &&
      typeof localStorage !== "undefined"
    ) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sliced));
      } catch {
        /* ignore */
      }
    }
    return sliced;
  } catch {
    return [];
  }
};

const loadFromStorage = (): AppLogEntry[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return [];
    return parseStoredLogs(raw, { rewriteDiskIfSanitized: true });
  } catch {
    return [];
  }
};

let entries: AppLogEntry[] = loadFromStorage();
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const fn of listeners) fn();
};

const persistEntries = (): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.code === 22);
    if (!isQuota) return;
    for (let factor = 2; factor <= 32; factor *= 2) {
      const target = Math.max(24, Math.floor(entries.length / factor));
      entries = entries.slice(0, target);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        notify();
        return;
      } catch {
        /* retry smaller */
      }
    }
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    if (event.newValue === null) {
      entries = [];
      notify();
      return;
    }
    entries = parseStoredLogs(event.newValue);
    notify();
  });
}

const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const appendAppLog = (
  partial: Omit<AppLogEntry, "id" | "ts"> & { id?: string; ts?: number },
): AppLogEntry => {
  const rawDetail =
    partial.detail !== undefined && partial.detail !== ""
      ? partial.detail
      : undefined;
  const detail = sanitizeDetail(rawDetail);
  const entry: AppLogEntry = {
    id: partial.id ?? newId(),
    ts: partial.ts ?? Date.now(),
    level: partial.level,
    category: partial.category,
    message: partial.message,
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  persistEntries();
  notify();
  return entry;
};

export const clearAppLogs = (): void => {
  entries = [];
  persistEntries();
  notify();
};

export const getAppLogsSnapshot = (): AppLogEntry[] => [...entries];

export const subscribeAppLogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const formatTs = (ts: number): string => {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
};

/** Newest-first lines (same order as the in-memory list). */
export const formatAppLogsAsText = (list: readonly AppLogEntry[]): string =>
  list
    .map((e) => {
      const base = `[${formatTs(e.ts)}] ${e.level.toUpperCase().padEnd(7)} [${e.category}] ${e.message}`;
      return e.detail ? `${base}\n  ${e.detail.replace(/\n/g, "\n  ")}` : base;
    })
    .join("\n");
