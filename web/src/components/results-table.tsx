import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { CellValue, QueryResult } from "../lib/api";
import { tabularToCsv } from "../lib/csv";
import { useSortedRows } from "../hooks/use-sorted-rows";
import { useVirtualList } from "../hooks/use-virtual-list";
import { cn } from "../lib/cn";

const ROW_HEIGHT = 32;
const MIN_COL_WIDTH = 160;

type ResultsTableProps = {
  result: QueryResult;
  resultsExpanded?: boolean;
  onToggleResultsExpanded?: () => void;
};

const cellSearchText = (value: CellValue): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

const rowMatchesFilter = (row: CellValue[], q: string): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return row.some((cell) => cellSearchText(cell).toLowerCase().includes(needle));
};

const renderCell = (value: CellValue) => {
  if (value === null || value === undefined) {
    return <span class="italic text-subtle">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span class="text-info">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span class="text-warn">{value}</span>;
  }
  return <span>{String(value)}</span>;
};

const SortGlyph = ({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) => {
  if (!active || dir === null) {
    return (
      <span aria-hidden="true" class="text-subtle">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" class="text-accent">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
};

export const ResultsTable = ({
  result,
  resultsExpanded = false,
  onToggleResultsExpanded,
}: ResultsTableProps) => {
  const { sortedRows, sort, toggleSort } = useSortedRows(result.rows);
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    setFilterText("");
  }, [result]);

  const filteredRows = useMemo(
    () => sortedRows.filter((row) => rowMatchesFilter(row, filterText)),
    [sortedRows, filterText],
  );

  const { containerRef, startIndex, endIndex, paddingTop, totalHeight } =
    useVirtualList<HTMLDivElement>({
      totalItems: filteredRows.length,
      rowHeight: ROW_HEIGHT,
    });

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = 0;
  }, [filterText, result, containerRef]);

  const visible = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex],
  );

  const gridTemplate = useMemo(() => {
    const n = result.columns.length;
    if (n === 0) return "";
    // `1fr` breaks intrinsic width when the grid is shrink-wrapped (wide tables
    // collapse to a single visible column). `auto` sizes each track from content.
    return `repeat(${n}, minmax(${MIN_COL_WIDTH}px, auto))`;
  }, [result.columns.length]);

  const handleDownloadCsv = useCallback(() => {
    const csv = tabularToCsv(result.columns, filteredRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `query-results-${stamp}.csv`;
    anchor.rel = "noopener";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result.columns, filteredRows]);

  if (result.columns.length === 0) {
    return (
      <div class="flex h-48 items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted">
        Query executed. No columns returned.
      </div>
    );
  }

  return (
    <div
      class={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface",
        resultsExpanded && "h-full w-full min-h-0 min-w-0",
      )}
    >
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <div class="flex shrink-0 items-center gap-2 font-mono text-[11px] text-subtle">
            <span class="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <span class="text-accent">result</span>
          </div>
          <div class="min-w-[12rem] max-w-full flex-1 sm:max-w-md">
            <label class="sr-only" for="results-grid-filter">
              Search result rows
            </label>
            <input
              id="results-grid-filter"
              type="search"
              class="input font-mono text-[12px]"
              placeholder="Search rows (any column)…"
              value={filterText}
              onInput={(e) => setFilterText((e.target as HTMLInputElement).value)}
              autoComplete="off"
              spellcheck={false}
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
          {filterText.trim() ? (
            <span class="badge">
              <span class="text-subtle">showing</span>
              <span class="text-text">{filteredRows.length.toLocaleString()}</span>
              <span class="text-subtle">/</span>
              <span class="text-muted">{sortedRows.length.toLocaleString()}</span>
            </span>
          ) : null}
          <span class="badge">
            <span class="text-subtle">rows</span>
            <span class="text-text">{result.row_count.toLocaleString()}</span>
          </span>
          <span class="badge">
            <span class="text-subtle">cols</span>
            <span class="text-text">{result.columns.length}</span>
          </span>
          <button
            type="button"
            class="btn"
            onClick={handleDownloadCsv}
            disabled={sortedRows.length === 0}
            title={
              sortedRows.length === 0
                ? "No rows to export"
                : "Download current table (sorted, filtered) as a .csv file"
            }
          >
            Export CSV
          </button>
          {onToggleResultsExpanded ? (
            <button
              type="button"
              class="btn"
              onClick={onToggleResultsExpanded}
              aria-expanded={resultsExpanded}
              aria-label={
                resultsExpanded
                  ? "Collapse results panel"
                  : "Expand results over the editor at full viewport width"
              }
              title={
                resultsExpanded
                  ? "Dock the results below the editor again"
                  : "Float results over the editor (full column height, full viewport width for wide tables)"
              }
            >
              {resultsExpanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        class="relative isolate min-h-0 flex-1 overflow-auto bg-code"
      >
        <div class="inline-block min-w-full align-top">
          <div
            role="row"
            class="sticky top-0 z-20 grid border-b border-border bg-surface-2"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {result.columns.map((column, index) => {
              const active = sort.columnIndex === index;
              return (
                <button
                  type="button"
                  key={`${column}-${index}`}
                  onClick={() => toggleSort(index)}
                  class={cn(
                    "flex min-h-[2.5rem] items-center justify-between gap-2 border-r border-border bg-surface-2 px-3 py-2 text-left font-mono text-[12px]",
                    "transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                    active ? "text-accent" : "text-text",
                  )}
                  aria-sort={
                    active && sort.direction
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <span class="truncate">{column}</span>
                  <SortGlyph active={active} dir={active ? sort.direction : null} />
                </button>
              );
            })}
          </div>

          {sortedRows.length === 0 ? (
            <div class="flex h-32 items-center justify-center text-sm text-muted">
              No rows returned.
            </div>
          ) : filteredRows.length === 0 ? (
            <div class="flex h-32 items-center justify-center px-4 text-center text-sm text-muted">
              No rows match “{filterText.trim()}”. Clear the search to see all rows.
            </div>
          ) : (
            <div class="relative z-0" style={{ height: totalHeight }}>
              <div style={{ transform: `translateY(${paddingTop}px)` }}>
                {visible.map((row, offset) => {
                  const rowIndex = startIndex + offset;
                  return (
                    <div
                      role="row"
                      key={rowIndex}
                      class={cn(
                        "grid border-b border-border/60 font-mono text-[12.5px] text-text transition-colors",
                        rowIndex % 2 === 1 ? "bg-bg/40" : "bg-code",
                        "hover:bg-accent-dim/40",
                      )}
                      style={{
                        gridTemplateColumns: gridTemplate,
                        height: ROW_HEIGHT,
                      }}
                    >
                      {row.map((cell, columnIndex) => (
                        <div
                          role="cell"
                          key={columnIndex}
                          class="flex items-center overflow-hidden border-r border-border/40 px-3"
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          <span class="truncate">{renderCell(cell)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
