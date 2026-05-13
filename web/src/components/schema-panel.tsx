import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  fetchColumns,
  fetchTables,
  type ColumnInfo,
  type TableInfo,
} from "../lib/api";
import type { ConnectionPayload } from "../lib/connections";
import { buildSelectSql, parseExpressions } from "../lib/query-builder-sql";
import {
  deleteSchemaColumnsCache,
  readSchemaColumnsCache,
  writeSchemaColumnsCache,
} from "../lib/schema-columns-cache";
import {
  readSchemaTablesCache,
  writeSchemaTablesCache,
} from "../lib/schema-tables-cache";
import { cn } from "../lib/cn";
import { SchemaSnippetEditor } from "./schema-snippet-editor";

type ColumnSortMode = "default" | "asc" | "desc";

const SORT_CYCLE: Record<ColumnSortMode, ColumnSortMode> = {
  default: "asc",
  asc: "desc",
  desc: "default",
};

const SORT_LABEL: Record<ColumnSortMode, string> = {
  default: "Sort: default",
  asc: "Sort: A → Z",
  desc: "Sort: Z → A",
};

const SORT_GLYPH: Record<ColumnSortMode, string> = {
  default: "↕",
  asc: "↑",
  desc: "↓",
};

type SchemaPanelProps = {
  connectionPayload: ConnectionPayload | undefined;
  onSendToEditor: (sql: string) => void;
  /** When the table list is ready, names are forwarded for SQL editor autocomplete */
  onTablesDiscovered?: (tableNames: readonly string[]) => void;
};

type Phase = "idle" | "loading" | "ready" | "error";

type ColumnCache = Record<string, ColumnInfo[]>;

const buildPayloadKey = (
  connection: ConnectionPayload | undefined,
): string => {
  if (!connection) return "__default__";
  return `${connection.url}::${connection.user}`;
};

export const SchemaPanel = ({
  connectionPayload,
  onSendToEditor,
  onTablesDiscovered,
}: SchemaPanelProps) => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesPhase, setTablesPhase] = useState<Phase>("idle");
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [columnsPhase, setColumnsPhase] = useState<Phase>("idle");
  const [columnsError, setColumnsError] = useState<string | null>(null);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnFilter, setColumnFilter] = useState("");
  const [columnSort, setColumnSort] = useState<ColumnSortMode>("default");
  const [functionsText, setFunctionsText] = useState("");
  const [whereClause, setWhereClause] = useState("");
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("ASC");
  const [limit, setLimit] = useState<number | null>(10);

  const columnCacheRef = useRef<Map<string, ColumnCache>>(new Map());
  const tableCacheRef = useRef<Map<string, TableInfo[]>>(new Map());
  const tablesAbortRef = useRef<AbortController | null>(null);
  const columnsAbortRef = useRef<AbortController | null>(null);

  const payloadKey = buildPayloadKey(connectionPayload);

  useEffect(() => {
    if (tablesPhase !== "ready") return;
    onTablesDiscovered?.(tables.map((entry) => entry.name));
  }, [tables, tablesPhase, onTablesDiscovered]);

  const loadTables = useCallback(
    async (force = false) => {
      tablesAbortRef.current?.abort();
      const cached = tableCacheRef.current.get(payloadKey);
      if (!force && cached !== undefined) {
        setTables(cached);
        setTablesPhase("ready");
        setTablesError(null);
        return;
      }

      if (!force) {
        const fromStorage = readSchemaTablesCache(payloadKey);
        if (fromStorage !== null) {
          tableCacheRef.current.set(payloadKey, fromStorage);
          setTables(fromStorage);
          setTablesPhase("ready");
          setTablesError(null);
          return;
        }
      }

      const controller = new AbortController();
      tablesAbortRef.current = controller;
      setTablesPhase("loading");
      setTablesError(null);
      try {
        const data = await fetchTables(
          connectionPayload,
          null,
          null,
          controller.signal,
        );
        tableCacheRef.current.set(payloadKey, data.tables);
        writeSchemaTablesCache(payloadKey, data.tables);
        setTables(data.tables);
        setTablesPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setTablesPhase("error");
        setTablesError(err instanceof Error ? err.message : String(err));
      }
    },
    [connectionPayload, payloadKey],
  );

  useEffect(() => {
    // Reset per-connection cache views when the active connection changes,
    // then auto-discover tables so the panel never appears empty on open.
    setActiveTable(null);
    setColumns([]);
    setColumnsPhase("idle");
    setColumnsError(null);
    setSelectedColumns([]);
    setColumnFilter("");
    setColumnSort("default");
    setFunctionsText("");
    let cached = tableCacheRef.current.get(payloadKey);
    if (cached === undefined) {
      const stored = readSchemaTablesCache(payloadKey);
      if (stored !== null) {
        tableCacheRef.current.set(payloadKey, stored);
        cached = stored;
      }
    }
    if (cached !== undefined) {
      setTables(cached);
      setTablesPhase("ready");
    } else {
      setTables([]);
      setTablesPhase("idle");
      void loadTables(false);
    }
    return () => {
      tablesAbortRef.current?.abort();
      columnsAbortRef.current?.abort();
    };
  }, [payloadKey, loadTables]);

  const loadColumnsForTable = useCallback(
    async (table: string, force: boolean) => {
      columnsAbortRef.current?.abort();

      const cacheForConnection =
        columnCacheRef.current.get(payloadKey) ?? {};
      const cachedCols = cacheForConnection[table];
      // Empty arrays are truthy in JS — never treat a cached [] as a hit or it
      // skips refetch forever after one failed or dictionary-empty response.
      if (
        !force &&
        Array.isArray(cachedCols) &&
        cachedCols.length > 0
      ) {
        setColumns(cachedCols);
        setColumnsPhase("ready");
        setColumnsError(null);
        return;
      }

      if (!force) {
        const fromStorage = readSchemaColumnsCache(payloadKey, table);
        if (fromStorage !== null) {
          const nextCache = { ...cacheForConnection, [table]: fromStorage };
          columnCacheRef.current.set(payloadKey, nextCache);
          setColumns(fromStorage);
          setColumnsPhase("ready");
          setColumnsError(null);
          return;
        }
      }

      const controller = new AbortController();
      columnsAbortRef.current = controller;
      setColumnsPhase("loading");
      setColumnsError(null);

      try {
        const data = await fetchColumns(
          table,
          connectionPayload,
          null,
          controller.signal,
        );
        const nextCache = { ...cacheForConnection };
        if (data.columns.length > 0) {
          nextCache[table] = data.columns;
          writeSchemaColumnsCache(payloadKey, table, data.columns);
        } else {
          delete nextCache[table];
          deleteSchemaColumnsCache(payloadKey, table);
        }
        columnCacheRef.current.set(payloadKey, nextCache);
        setColumns(data.columns);
        setColumnsPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setColumnsPhase("error");
        setColumnsError(err instanceof Error ? err.message : String(err));
      }
    },
    [connectionPayload, payloadKey],
  );

  const handleSelectTable = useCallback(
    (table: string) => {
      setActiveTable(table);
      setSelectedColumns([]);
      setOrderBy("");
      setColumnFilter("");
      setColumnSort("default");
      setFunctionsText("");
      void loadColumnsForTable(table, false);
    },
    [loadColumnsForTable],
  );

  const filteredTables = useMemo(() => {
    const term = tableFilter.trim().toLowerCase();
    if (!term) return tables;
    return tables.filter((entry) =>
      entry.name.toLowerCase().includes(term),
    );
  }, [tables, tableFilter]);

  const toggleColumn = (column: string) => {
    setSelectedColumns((prev) =>
      prev.includes(column)
        ? prev.filter((value) => value !== column)
        : [...prev, column],
    );
  };

  const visibleColumns = useMemo(() => {
    const term = columnFilter.trim().toLowerCase();
    const filtered = term
      ? columns.filter((entry) => entry.name.toLowerCase().includes(term))
      : columns.slice();
    if (columnSort === "default") return filtered;
    return filtered.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return columnSort === "asc" ? cmp : -cmp;
    });
  }, [columns, columnFilter, columnSort]);

  const visibleNames = useMemo(
    () => visibleColumns.map((entry) => entry.name),
    [visibleColumns],
  );

  const allVisibleSelected =
    visibleNames.length > 0 &&
    visibleNames.every((name) => selectedColumns.includes(name));

  const toggleAllVisible = () => {
    if (visibleNames.length === 0) return;
    setSelectedColumns((prev) => {
      const set = new Set(prev);
      if (allVisibleSelected) {
        for (const name of visibleNames) set.delete(name);
      } else {
        for (const name of visibleNames) set.add(name);
      }
      return Array.from(set);
    });
  };

  const cycleColumnSort = () => {
    setColumnSort((current) => SORT_CYCLE[current]);
  };

  const expressions = useMemo(
    () => parseExpressions(functionsText),
    [functionsText],
  );

  const schemaColumnNames = useMemo(
    () => columns.map((c) => c.name),
    [columns],
  );

  const generatedSql = useMemo(
    () =>
      buildSelectSql({
        table: activeTable ?? "",
        columns: selectedColumns,
        expressions,
        where: whereClause,
        orderBy,
        orderDir,
        limit,
      }),
    [
      activeTable,
      selectedColumns,
      expressions,
      whereClause,
      orderBy,
      orderDir,
      limit,
    ],
  );

  const handleLimitInput: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === "") {
      setLimit(null);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    setLimit(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  };

  const handleCopySql = async () => {
    if (!generatedSql) return;
    try {
      await navigator.clipboard.writeText(generatedSql);
    } catch {
      // ignore — best effort
    }
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void loadTables(true)}
          disabled={tablesPhase === "loading"}
          title="Fetch the latest table list from the server"
        >
          {tablesPhase === "loading"
            ? tables.length === 0
              ? "Discovering…"
              : "Reloading…"
            : tables.length === 0
              ? "Discover tables"
              : "Reload tables"}
        </button>
      </div>

      {tablesError && (
        <div class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {tablesError}
        </div>
      )}

      <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div class="border-b border-border bg-surface-2 p-2">
            <input
              class="input"
              type="search"
              placeholder="Filter tables…"
              value={tableFilter}
              onInput={(e) =>
                setTableFilter((e.target as HTMLInputElement).value)
              }
            />
          </div>
          <div class="flex-1 overflow-auto">
            {tablesPhase === "idle" && (
              <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                Press <span class="text-text">Discover tables</span> to load the
                schema from the active connection.
              </p>
            )}
            {tablesPhase === "loading" && (
              <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                Loading schema…
              </p>
            )}
            {tablesPhase === "ready" && filteredTables.length === 0 && (
              <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                {tables.length === 0
                  ? "No tables returned."
                  : "No matches for the current filter."}
              </p>
            )}
            <ul>
              {filteredTables.map((entry) => {
                const isActive = entry.name === activeTable;
                return (
                  <li key={`${entry.schema ?? ""}::${entry.name}`}>
                    <button
                      type="button"
                      onClick={() => void handleSelectTable(entry.name)}
                      class={cn(
                        "block w-full truncate border-l-2 px-3 py-1.5 text-left font-mono text-[12px] transition-colors",
                        isActive
                          ? "border-accent bg-accent-dim/40 text-accent"
                          : "border-transparent text-text hover:bg-surface-2",
                      )}
                    >
                      <span>{entry.name}</span>
                      {entry.type && entry.type !== "TABLE" && (
                        <span class="ml-2 text-[10px] text-subtle">
                          {entry.type}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div class="border-t border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-subtle">
            {tables.length} table(s){" "}
            {tableFilter && `· ${filteredTables.length} match`}
          </div>
        </div>

        <div class="flex min-h-0 flex-col gap-3 overflow-hidden">
          {!activeTable ? (
            <div class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 font-mono text-[12px] text-muted">
              Pick a table from the list to start building a SELECT.
            </div>
          ) : (
            <>
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <div class="flex items-center gap-2 font-mono text-[12px] text-text">
                  <span class="text-accent">{activeTable}</span>
                  <span class="badge">
                    <span class="text-subtle">cols</span>
                    <span class="text-text">{columns.length}</span>
                  </span>
                  <span class="badge">
                    <span class="text-subtle">selected</span>
                    <span class="text-text">{selectedColumns.length}</span>
                  </span>
                  {expressions.length > 0 && (
                    <span class="badge">
                      <span class="text-subtle">expr</span>
                      <span class="text-text">{expressions.length}</span>
                    </span>
                  )}
                </div>
              </div>

              {columnsError && (
                <div class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
                  {columnsError}
                </div>
              )}

              <div class="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
                <div class="flex h-[min(37.5rem,calc(100dvh-10rem))] min-h-[220px] flex-col overflow-hidden rounded-lg border border-border bg-surface">
                  <div class="flex flex-col gap-2 border-b border-border bg-surface-2 px-3 py-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-mono text-[11px] text-subtle">
                        Columns — click to add to SELECT
                      </span>
                      <div class="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          class="btn btn-primary py-0.5 text-[11px]"
                          onClick={() =>
                            activeTable &&
                            void loadColumnsForTable(activeTable, true)
                          }
                          disabled={columnsPhase === "loading"}
                          title="Fetch the latest column list from the server"
                        >
                          {columnsPhase === "loading"
                            ? "Reloading…"
                            : "Reload columns"}
                        </button>
                        <button
                          type="button"
                          onClick={toggleAllVisible}
                          disabled={visibleColumns.length === 0}
                          class="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {allVisibleSelected ? "Clear visible" : "Select all"}
                        </button>
                      </div>
                    </div>
                    <input
                      type="search"
                      class="input"
                      placeholder="Search columns…"
                      value={columnFilter}
                      onInput={(e) =>
                        setColumnFilter(
                          (e.target as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                  <div class="min-h-0 flex-1 overflow-auto">
                    {columnsPhase === "loading" ? (
                      <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                        Loading columns…
                      </p>
                    ) : columns.length === 0 ? (
                      <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                        No columns returned.
                      </p>
                    ) : visibleColumns.length === 0 ? (
                      <p class="px-3 py-6 text-center font-mono text-[12px] text-muted">
                        No columns match "{columnFilter}".
                      </p>
                    ) : (
                      <ul class="divide-y divide-border/60">
                        <li class="sticky top-0 z-[1] border-b border-border/80 bg-surface px-3 py-1">
                          <div
                            class="grid w-full items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-subtle"
                            style={{
                              gridTemplateColumns:
                                "1rem minmax(0,1fr) minmax(5rem,9rem) auto",
                            }}
                          >
                            <span aria-hidden="true" />
                            <button
                              type="button"
                              onClick={cycleColumnSort}
                              class="flex min-h-[1.25rem] min-w-0 max-w-full items-center gap-1 truncate rounded px-0.5 text-left font-mono text-[10px] uppercase tracking-wide text-subtle transition-colors hover:bg-surface-2 hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                              title={SORT_LABEL[columnSort]}
                              aria-label={SORT_LABEL[columnSort]}
                            >
                              <span class="min-w-0 truncate">Column name</span>
                              <span
                                class="shrink-0 font-mono text-[11px] text-muted normal-case tracking-normal"
                                aria-hidden="true"
                              >
                                {SORT_GLYPH[columnSort]}
                              </span>
                            </button>
                            <span
                              class="truncate"
                              title="sys_glide_object.label"
                            >
                              Type
                            </span>
                            <span aria-hidden="true" />
                          </div>
                        </li>
                        {visibleColumns.map((entry) => {
                          const isSelected = selectedColumns.includes(
                            entry.name,
                          );
                          const displayType =
                            (entry.field_type && entry.field_type.trim()) ||
                            (entry.internal_type &&
                              entry.internal_type.trim()) ||
                            (entry.type && entry.type.trim()) ||
                            "";
                          return (
                            <li key={entry.name}>
                              <button
                                type="button"
                                onClick={() => toggleColumn(entry.name)}
                                class={cn(
                                  "grid w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px]",
                                  "transition-colors hover:bg-surface-2",
                                  isSelected && "bg-accent-dim/30",
                                )}
                                style={{
                                  gridTemplateColumns:
                                    "1rem minmax(0,1fr) minmax(5rem,9rem) auto",
                                }}
                              >
                                <span
                                  aria-hidden="true"
                                  class={cn(
                                    "grid h-4 w-4 place-items-center rounded border text-[10px]",
                                    isSelected
                                      ? "border-accent bg-accent text-bg"
                                      : "border-border text-transparent",
                                  )}
                                >
                                  ✓
                                </span>
                                <span class="flex-1 truncate text-text">
                                  {entry.name}
                                </span>
                                {displayType ? (
                                  <span
                                    class={cn(
                                      "max-w-[144px] truncate text-[11px]",
                                      entry.field_type || entry.internal_type
                                        ? "text-accent"
                                        : "text-info",
                                    )}
                                    title={
                                      entry.internal_type
                                        ? `internal_type: ${entry.internal_type} · display: ${entry.type}`
                                        : entry.field_type
                                          ? `display: ${entry.type}`
                                          : `type: ${entry.type}`
                                    }
                                  >
                                    {displayType}
                                  </span>
                                ) : (
                                  <span
                                    class="text-[11px] text-subtle"
                                    title="No type from dictionary"
                                  >
                                    —
                                  </span>
                                )}
                                {!entry.nullable ? (
                                  <span class="text-[10px] text-warn">
                                    NOT NULL
                                  </span>
                                ) : (
                                  <span aria-hidden="true" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div class="border-t border-border bg-surface-2 px-3 py-1 font-mono text-[10px] text-subtle">
                    {visibleColumns.length} of {columns.length} shown
                    {columnFilter && ` · filter "${columnFilter}"`}
                  </div>
                </div>

                <div class="flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border border-border bg-surface p-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-mono text-[11px] text-subtle">Filters</span>
                    <span class="font-mono text-[10px] text-subtle/80">
                      Ctrl+Space (⌃Space): SQL keywords and columns for the
                      selected table
                    </span>
                  </div>

                  <label class="flex flex-col gap-1">
                    <span class="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-subtle">
                      <span>functions / expressions</span>
                      <span class="normal-case text-subtle/80">
                        one per line · added to{" "}
                        <code class="rounded border border-border bg-surface-2 px-1 py-0.5 text-[10px] text-info">
                          SELECT
                        </code>
                      </span>
                    </span>
                    <SchemaSnippetEditor
                      value={functionsText}
                      onChange={setFunctionsText}
                      placeholder={
                        "COUNT(*) AS total\nMAX(priority) AS top_priority"
                      }
                      schemaTable={activeTable}
                      columnNames={schemaColumnNames}
                      aria-label="SELECT expressions, one per line"
                    />
                  </label>

                  <label class="flex flex-col gap-1">
                    <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
                      where
                    </span>
                    <SchemaSnippetEditor
                      value={whereClause}
                      onChange={setWhereClause}
                      placeholder="priority = 1 AND active = true"
                      schemaTable={activeTable}
                      columnNames={schemaColumnNames}
                      aria-label="WHERE clause"
                    />
                  </label>

                  <div class="grid grid-cols-2 gap-2">
                    <label class="flex flex-col gap-1">
                      <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
                        order by
                      </span>
                      <select
                        class="input cursor-pointer"
                        value={orderBy}
                        onChange={(e) =>
                          setOrderBy(
                            (e.target as HTMLSelectElement).value,
                          )
                        }
                      >
                        <option value="">— none —</option>
                        {columns.map((entry) => (
                          <option key={entry.name} value={entry.name}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="flex flex-col gap-1">
                      <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
                        direction
                      </span>
                      <select
                        class="input cursor-pointer"
                        value={orderDir}
                        onChange={(e) =>
                          setOrderDir(
                            (e.target as HTMLSelectElement).value as
                              | "ASC"
                              | "DESC",
                          )
                        }
                      >
                        <option value="ASC">ASC</option>
                        <option value="DESC">DESC</option>
                      </select>
                    </label>
                  </div>

                  <label class="flex flex-col gap-1">
                    <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
                      limit
                    </span>
                    <input
                      class="input"
                      type="number"
                      min="1"
                      step="1"
                      value={limit ?? ""}
                      placeholder="no limit"
                      onInput={handleLimitInput}
                    />
                  </label>
                </div>
              </div>

              <div class="flex min-h-[120px] flex-col overflow-hidden rounded-lg border border-border bg-code">
                <div class="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5">
                  <span class="font-mono text-[11px] text-subtle">
                    generated SQL
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="btn"
                      onClick={handleCopySql}
                      disabled={!generatedSql}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary"
                      onClick={() => onSendToEditor(generatedSql)}
                      disabled={!generatedSql}
                    >
                      Open in Editor
                    </button>
                  </div>
                </div>
                <pre class="flex-1 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed text-text">
                  {generatedSql ||
                    "-- pick at least a table to generate SQL --"}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
