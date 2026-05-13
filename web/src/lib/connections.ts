import { parseInstanceFromUrl } from "./parse-instance";

export type SavedConnection = {
  id: string;
  /** ServiceNow instance (derived from JDBC URL); kept for export/import compatibility. */
  name: string;
  url: string;
  user: string;
  password: string;
  driverClass: string;
};

export type ConnectionFormState = Omit<SavedConnection, "id">;

export type ConnectionPayload = {
  url: string;
  user: string;
  password: string;
  driver_class?: string;
};

export const SERVER_DEFAULT_ID = "__server_default__";

export const STORAGE_KEYS = {
  connections: "sn-sql-api:connections:v1",
  activeId: "sn-sql-api:connections:activeId",
} as const;

export const EXPORT_FORMAT = "sn-sql-api.connections.v1";

export type ExportPayload = {
  format: typeof EXPORT_FORMAT;
  exported_at: string;
  connections: SavedConnection[];
};

export const generateId = (): string =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `conn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const URL_INSTANCE_PLACEHOLDER = "<your-instance>";
export const DEFAULT_JDBC_URL = `jdbc:servicenow://https://${URL_INSTANCE_PLACEHOLDER}.service-now.com`;
export const DEFAULT_DRIVER_CLASS = "com.snc.db.jdbc.JDBCDriver";

export const emptyConnection = (): ConnectionFormState => ({
  name: "",
  url: DEFAULT_JDBC_URL,
  user: "",
  password: "",
  driverClass: DEFAULT_DRIVER_CLASS,
});

/** Instance label for UI; falls back to stored name when the URL cannot be parsed. */
export const connectionInstanceLabel = (connection: {
  url: string;
  name: string;
}): string =>
  parseInstanceFromUrl(connection.url).trim() || connection.name.trim();

/** Persisted `name` for a connection: always the instance substring from the URL when possible. */
export const deriveConnectionName = (url: string): string =>
  parseInstanceFromUrl(url.trim()).trim();

export const toPayload = (
  connection: SavedConnection,
): ConnectionPayload | undefined => {
  if (!connection.url.trim() || !connection.user.trim()) return undefined;
  const payload: ConnectionPayload = {
    url: connection.url.trim(),
    user: connection.user.trim(),
    password: connection.password,
  };
  if (connection.driverClass.trim()) {
    payload.driver_class = connection.driverClass.trim();
  }
  return payload;
};

const sanitizeRecord = (raw: unknown): SavedConnection | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const legacyName = typeof obj.name === "string" ? obj.name.trim() : "";
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  const user = typeof obj.user === "string" ? obj.user.trim() : "";
  const password = typeof obj.password === "string" ? obj.password : "";
  const driverClass =
    typeof obj.driverClass === "string"
      ? obj.driverClass.trim()
      : typeof obj.driver_class === "string"
        ? (obj.driver_class as string).trim()
        : "";

  const name = deriveConnectionName(url) || legacyName;
  if (!name || !url || !user) return null;

  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id : generateId();
  return { id, name, url, user, password, driverClass };
};

export const parseImport = (raw: string): SavedConnection[] => {
  const data = JSON.parse(raw) as unknown;
  if (Array.isArray(data)) {
    return data
      .map(sanitizeRecord)
      .filter((entry): entry is SavedConnection => entry !== null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.format && obj.format !== EXPORT_FORMAT) {
      throw new Error(`Unsupported export format: ${String(obj.format)}`);
    }
    const list = Array.isArray(obj.connections) ? obj.connections : [];
    return list
      .map(sanitizeRecord)
      .filter((entry): entry is SavedConnection => entry !== null);
  }
  throw new Error("Invalid JSON payload");
};

export const buildExport = (
  connections: SavedConnection[],
): ExportPayload => ({
  format: EXPORT_FORMAT,
  exported_at: new Date().toISOString(),
  connections,
});
