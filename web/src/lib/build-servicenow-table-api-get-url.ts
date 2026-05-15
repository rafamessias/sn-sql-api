import type { ConnectionPayload } from "./connections";
import type { TableApiFormState } from "./table-api-form";

const TABLE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SN_SUFFIX = ".service-now.com";

function hostToHttpsOrigin(host: string): string {
  const raw = host.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Empty host");
  const lower = raw.toLowerCase();
  if (lower.startsWith("https://")) {
    const rest = raw.slice(8).split("/")[0] ?? "";
    return `https://${rest}`;
  }
  if (lower.startsWith("http://")) {
    const rest = raw.slice(7).split("/")[0] ?? "";
    return `https://${rest}`;
  }
  const h = raw.includes(".") ? raw : `${raw}${SN_SUFFIX}`;
  return `https://${h}`;
}

/** Match ``src/rest_base_url.jdbc_url_to_https_origin`` for Table API GET URLs. */
export function jdbcUrlToHttpsOrigin(jdbcUrl: string): string {
  const text = jdbcUrl.trim();
  const m = text.match(/jdbc:servicenow:\/\/(?:https?:\/\/)?([^/;:?\s]+)/i);
  if (m?.[1]) return hostToHttpsOrigin(m[1]);
  const m2 = text.match(/Server=https?:\/\/([^/;:?\s]+)/i);
  if (m2?.[1]) return hostToHttpsOrigin(m2[1]);
  throw new Error("Could not parse ServiceNow host from JDBC URL");
}

/**
 * Build the GET ``/api/now/table/{table}`` URL with sysparms (same shape the server uses).
 * When `connection` is set, returns a full ``https://…`` origin; otherwise path + query only.
 */
export function buildServiceNowTableApiGetUrl(
  connection: ConnectionPayload | undefined,
  form: TableApiFormState,
): { url: string; hadOrigin: boolean } | null {
  const table = form.table.trim();
  if (!table || !TABLE_SEGMENT.test(table)) return null;

  const params = new URLSearchParams();
  const q = form.sysparm_query.trim();
  if (q) params.set("sysparm_query", q);
  const fields = form.sysparm_fields.trim();
  if (fields) params.set("sysparm_fields", fields);
  const lim = Number.parseInt(form.sysparm_limit.trim(), 10);
  if (Number.isFinite(lim) && lim > 0) {
    params.set("sysparm_limit", String(Math.floor(lim)));
  }
  const off = Number.parseInt(form.sysparm_offset.trim(), 10);
  if (Number.isFinite(off) && off >= 0) {
    params.set("sysparm_offset", String(Math.floor(off)));
  }
  const dv = form.sysparm_display_value.trim().toLowerCase();
  if (dv === "true" || dv === "false" || dv === "all") {
    params.set("sysparm_display_value", dv);
  }
  if (form.sysparm_exclude_reference_link) {
    params.set("sysparm_exclude_reference_link", "true");
  }
  const view = form.sysparm_view.trim();
  if (view) params.set("sysparm_view", view);

  const path = `/api/now/table/${encodeURIComponent(table)}`;
  const qs = params.toString();
  const pathAndQuery = qs ? `${path}?${qs}` : path;

  if (connection?.url?.trim()) {
    try {
      const origin = jdbcUrlToHttpsOrigin(connection.url).replace(/\/$/, "");
      return { url: `${origin}${pathAndQuery}`, hadOrigin: true };
    } catch {
      return { url: pathAndQuery, hadOrigin: false };
    }
  }
  return { url: pathAndQuery, hadOrigin: false };
}
