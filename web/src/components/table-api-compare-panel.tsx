import { useCallback } from "preact/hooks";
import { sqlToSysparm, sysparmToSql } from "../lib/sql-sysparm-translate";
import type { TableApiFormState } from "../lib/table-api-form";

export type { TableApiFormState } from "../lib/table-api-form";
export { defaultTableApiForm } from "../lib/table-api-form";

const TABLE_API_DOCS =
  "https://www.servicenow.com/docs/csh?topicname=c_TableAPI.html&version=latest";

type TableApiComparePanelProps = {
  sqlText: string;
  form: TableApiFormState;
  onFormChange: (next: TableApiFormState) => void;
  onRunRest: () => void;
  onRunBoth: () => void;
  onTranslateNotice: (message: string) => void;
  restRunning: boolean;
  jdbcRunning: boolean;
  disableRestRun: boolean;
};

export const TableApiComparePanel = ({
  sqlText,
  form,
  onFormChange,
  onRunRest,
  onRunBoth,
  onTranslateNotice,
  restRunning,
  jdbcRunning,
  disableRestRun,
}: TableApiComparePanelProps) => {
  const patch = useCallback(
    (partial: Partial<TableApiFormState>) => {
      onFormChange({ ...form, ...partial });
    },
    [form, onFormChange],
  );

  const handleSyncFromSql = useCallback(() => {
    const translated = sqlToSysparm(sqlText);
    if (!translated.ok) {
      onTranslateNotice(translated.warnings.join(" "));
      return;
    }
    onFormChange({
      ...form,
      table: translated.table,
      sysparm_query: translated.sysparm_query,
      sysparm_fields: translated.sysparm_fields ?? "",
      sysparm_limit:
        translated.sysparm_limit != null
          ? String(translated.sysparm_limit)
          : form.sysparm_limit,
    });
    const extra =
      translated.warnings.length > 0 ? ` · ${translated.warnings.join(" · ")}` : "";
    onTranslateNotice(`Mapped SQL to Table API fields.${extra}`);
  }, [form, onFormChange, onTranslateNotice, sqlText]);

  const handleSyncToSql = useCallback(() => {
    const lim = Number.parseInt(form.sysparm_limit.trim(), 10);
    const { sql, warnings } = sysparmToSql({
      table: form.table,
      sysparm_query: form.sysparm_query,
      sysparm_fields: form.sysparm_fields.trim() || null,
      sysparm_limit: Number.isFinite(lim) && lim > 0 ? lim : null,
    });
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(sql);
      onTranslateNotice(
        warnings.length > 0
          ? `Copied approximate SQL. ${warnings.join(" · ")}`
          : "Copied approximate SQL to the clipboard.",
      );
    }
  }, [form, onTranslateNotice]);

  const busy = restRunning || jdbcRunning;

  return (
    <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div class="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-hidden rounded-lg border border-border">
        <div class="flex shrink-0 flex-col gap-2 border-b border-border bg-surface-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 flex-col gap-0.5 font-mono text-[11px] text-subtle">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 shrink-0 rounded-full bg-info" />
              <span class="text-info">Table API</span>
              <span class="text-subtle">— GET /api/now/table/…</span>
            </div>
            <a
              href={TABLE_API_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              class="text-[10px] text-accent underline-offset-2 hover:underline"
            >
              ServiceNow Table API reference
            </a>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn px-2 py-1 text-[11px]"
              title="Fill table and sysparm fields from the JDBC query (best-effort)"
              onClick={handleSyncFromSql}
              disabled={busy || !sqlText.trim()}
            >
              SQL → sysparm
            </button>
            <button
              type="button"
              class="btn px-2 py-1 text-[11px]"
              title="Build approximate SELECT and copy to clipboard"
              onClick={handleSyncToSql}
              disabled={busy || !form.table.trim()}
            >
              sysparm → SQL (copy)
            </button>
          </div>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1 text-[11px] sm:col-span-2">
              <span class="text-subtle">Table (API name)</span>
              <input
                type="text"
                class="input font-mono text-[12px]"
                autoComplete="off"
                spellcheck={false}
                placeholder="e.g. incident"
                value={form.table}
                onInput={(e) =>
                  patch({ table: (e.target as HTMLInputElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px] sm:col-span-2">
              <span class="text-subtle">sysparm_query (encoded query)</span>
              <textarea
                class="input min-h-[5.5rem] resize-y font-mono text-[12px]"
                placeholder="active=true^priority=1"
                value={form.sysparm_query}
                onInput={(e) =>
                  patch({ sysparm_query: (e.target as HTMLTextAreaElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px]">
              <span class="text-subtle">sysparm_fields (comma-separated)</span>
              <input
                type="text"
                class="input font-mono text-[12px]"
                autoComplete="off"
                spellcheck={false}
                placeholder="number,short_description,sys_id"
                value={form.sysparm_fields}
                onInput={(e) =>
                  patch({ sysparm_fields: (e.target as HTMLInputElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px]">
              <span class="text-subtle">sysparm_limit</span>
              <input
                type="text"
                class="input font-mono text-[12px]"
                inputMode="numeric"
                value={form.sysparm_limit}
                onInput={(e) =>
                  patch({ sysparm_limit: (e.target as HTMLInputElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px]">
              <span class="text-subtle">sysparm_offset (pagination)</span>
              <input
                type="text"
                class="input font-mono text-[12px]"
                inputMode="numeric"
                placeholder="0"
                value={form.sysparm_offset}
                onInput={(e) =>
                  patch({ sysparm_offset: (e.target as HTMLInputElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px] sm:col-span-2">
              <span class="text-subtle">sysparm_view</span>
              <input
                type="text"
                class="input font-mono text-[12px]"
                autoComplete="off"
                spellcheck={false}
                placeholder="optional view name"
                value={form.sysparm_view}
                onInput={(e) =>
                  patch({ sysparm_view: (e.target as HTMLInputElement).value })
                }
                disabled={busy}
              />
            </label>

            <label class="flex flex-col gap-1 text-[11px]">
              <span class="text-subtle">sysparm_display_value</span>
              <select
                class="input font-mono text-[12px]"
                value={form.sysparm_display_value}
                onChange={(e) =>
                  patch({
                    sysparm_display_value: (e.target as HTMLSelectElement)
                      .value as TableApiFormState["sysparm_display_value"],
                  })
                }
                disabled={busy}
              >
                <option value="">(default)</option>
                <option value="true">true</option>
                <option value="false">false</option>
                <option value="all">all</option>
              </select>
            </label>

            <label class="flex items-center gap-2 text-[11px] text-subtle">
              <input
                type="checkbox"
                checked={form.sysparm_exclude_reference_link}
                onChange={(e) =>
                  patch({
                    sysparm_exclude_reference_link: (e.target as HTMLInputElement)
                      .checked,
                  })
                }
                disabled={busy}
              />
              sysparm_exclude_reference_link
            </label>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-2">
          <button
            type="button"
            class="btn btn-primary"
            onClick={onRunRest}
            disabled={disableRestRun || busy}
          >
            {restRunning ? "REST…" : "Run Table API"}
          </button>
          <button
            type="button"
            class="btn"
            title="Run JDBC and Table API in parallel for timing comparison"
            onClick={onRunBoth}
            disabled={
              busy ||
              !sqlText.trim() ||
              !form.table.trim() ||
              disableRestRun
            }
          >
            Run both (compare)
          </button>
        </div>
      </div>
    </section>
  );
};
