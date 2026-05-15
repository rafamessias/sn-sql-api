import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import type { CellValue, QueryResult } from "../lib/api";
import { tabularToCsv } from "../lib/csv";
import { useSortedRows } from "../hooks/use-sorted-rows";
import { useVirtualList } from "../hooks/use-virtual-list";
import { cn } from "../lib/cn";

const ROW_HEIGHT = 32;
/** Sticky header row inside the scroll area (`min-h-[2.5rem]`). */
const SCROLL_GRID_HEADER_REM = 2.5;
/** Default cap on visible data rows before vertical scroll (non-expanded). */
export const RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS = 25;
/** Minimum `ch` width for a data column (header + cell padding). */
const MIN_DATA_COL_CH = 6;
/** Extra `ch` beyond longest sampled string (padding + sort icon in header). */
const COL_WIDTH_PAD_CH = 3;
/** Sampled max length at or above this → treat column as long-text (truncate in cell, cap width). */
const LONG_TEXT_CHAR_THRESHOLD = 32;
/** Max `ch` for normal data columns (full value on `title` / CSV). */
const MAX_DATA_COL_CH = 48;
/** Max `ch` for long-text columns. */
const MAX_LONG_TEXT_COL_CH = 32;
/** Hard cap on measured string length when turning it into `ch` (pathological cells). */
const MAX_CH_FOR_MIN = 400;
/** Rows scanned when inferring column widths (full grid still sorts/filters all rows). */
const WIDTH_SAMPLE_ROW_CAP = 200;
/** Max rows kept in memory for sort/filter/render (avoids main-thread freezes). */
export const RESULTS_TABLE_MAX_DISPLAY_ROWS = 2_500;
/** Minimum `ch` for the row-number column. */
const MIN_ROW_NUM_COL_CH = 4;
/** Extra `ch` for row-number padding (commas + cell padding). */
const ROW_NUM_PAD_CH = 2;
/** Rough `ch` → px for intrinsic width estimate (monospace ~12.5px). */
const CH_TO_PX_EST = 8.1;
/** Horizontal padding/borders fudge per column (px). */
const COL_WIDTH_PAD_PX = 28;
/** Max `fr` weight so one column cannot starve the rest when stretching. */
const MAX_FR_WEIGHT = 24;

type ResultsTableProps = {
  result: QueryResult;
  resultsExpanded?: boolean;
  onToggleResultsExpanded?: () => void;
  /** Shown next to the status dot; omit when a title is shown outside the table. */
  resultLabel?: string;
  /**
   * Max data rows in the scroll viewport before scrolling (sticky column header counts toward height).
   * Omit for `RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS`. Pass `null` for no cap.
   * Ignored when `resultsExpanded` is true.
   */
  maxVisibleDataRows?: number | null;
  /**
   * Max rows loaded into the grid for sort/filter/render.
   * Default: no cap (all API rows; scroll via virtual list). Pass `RESULTS_TABLE_MAX_DISPLAY_ROWS` to cap.
   */
  maxDisplayRows?: number | null;
};

const cellSearchText = (value: CellValue): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

/** Width for row index `1 … rowCount` (locale commas, e.g. `50,000`). */
const computeRowNumColCh = (rowCount: number): number => {
  const labelLen = Math.max(1, rowCount).toLocaleString().length;
  return Math.max(MIN_ROW_NUM_COL_CH, labelLen + ROW_NUM_PAD_CH);
};

type ColumnTrack = {
  minCh: number;
  frWeight: number;
  isLongText: boolean;
};

const computeColumnTracks = (
  columns: string[],
  rows: CellValue[][],
): ColumnTrack[] => {
  const sample = rows.length > WIDTH_SAMPLE_ROW_CAP ? rows.slice(0, WIDTH_SAMPLE_ROW_CAP) : rows;
  return columns.map((name, colIndex) => {
    let maxChars = name.length;
    for (const row of sample) {
      const len = cellSearchText(row[colIndex] ?? null).length;
      if (len > maxChars) maxChars = len;
    }
    const contentCh = Math.min(maxChars + COL_WIDTH_PAD_CH, MAX_CH_FOR_MIN);
    const isLongTextCol = maxChars >= LONG_TEXT_CHAR_THRESHOLD;
    if (isLongTextCol) {
      const minCh = Math.max(
        MIN_DATA_COL_CH,
        Math.min(contentCh, MAX_LONG_TEXT_COL_CH),
      );
      return {
        minCh,
        frWeight: 1,
        isLongText: true,
      };
    }
    const minCh = Math.max(MIN_DATA_COL_CH, Math.min(contentCh, MAX_DATA_COL_CH));
    return {
      minCh,
      frWeight: Math.max(1, Math.min(Math.ceil(minCh / 3), MAX_FR_WEIGHT)),
      isLongText: false,
    };
  });
};

const estimateIntrinsicWidthPx = (
  rowNumCh: number,
  tracks: ColumnTrack[],
): number => {
  let sum = rowNumCh * CH_TO_PX_EST + COL_WIDTH_PAD_PX;
  for (const { minCh } of tracks) {
    sum += minCh * CH_TO_PX_EST + COL_WIDTH_PAD_PX;
  }
  return Math.ceil(sum);
};

const buildGridTemplate = (
  rowNumCh: number,
  tracks: ColumnTrack[],
  mode: "stretch" | "scroll",
): string => {
  const rowTrack = `${rowNumCh}ch`;
  if (tracks.length === 0) {
    return rowTrack;
  }
  const dataTracks =
    mode === "scroll"
      ? tracks.map(({ minCh }) => `${minCh}ch`)
      : tracks.map(({ minCh, frWeight, isLongText }) => {
          // Long-text: fixed width. Others: grow with fr (never use min(max, fr) — fr can be < min and break the grid).
          if (isLongText) {
            return `${minCh}ch`;
          }
          return `minmax(${minCh}ch, ${frWeight}fr)`;
        });
  return `${rowTrack} ${dataTracks.join(" ")}`;
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
  resultLabel,
  maxVisibleDataRows,
  maxDisplayRows,
}: ResultsTableProps) => {
  const dataRowCap = resultsExpanded
    ? undefined
    : maxVisibleDataRows === null
      ? undefined
      : maxVisibleDataRows !== undefined
        ? maxVisibleDataRows
        : RESULTS_TABLE_DEFAULT_MAX_DATA_ROWS;

  const displayRowCap =
    maxDisplayRows === null
      ? null
      : maxDisplayRows !== undefined
        ? maxDisplayRows
        : null;

  const totalRowCount = result.row_count;
  const rowsTruncated =
    displayRowCap != null && result.rows.length > displayRowCap;
  const displayRows = useMemo(
    () =>
      rowsTruncated && displayRowCap != null
        ? result.rows.slice(0, displayRowCap)
        : result.rows,
    [result.rows, rowsTruncated, displayRowCap],
  );

  const scrollAreaMaxHeight =
    dataRowCap != null && dataRowCap > 0
      ? `calc(${SCROLL_GRID_HEADER_REM}rem + ${dataRowCap * ROW_HEIGHT}px)`
      : undefined;

  const { sortedRows, sort, toggleSort } = useSortedRows(displayRows);
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

  const rowNumColCh = useMemo(
    () => computeRowNumColCh(totalRowCount),
    [totalRowCount],
  );

  const columnTracks = useMemo(
    () => computeColumnTracks(result.columns, displayRows),
    [result.columns, displayRows],
  );

  const intrinsicWidthPx = useMemo(
    () => estimateIntrinsicWidthPx(rowNumColCh, columnTracks),
    [rowNumColCh, columnTracks],
  );

  /** Start false until measured — stretch + fr before layout yields invalid grid tracks. */
  const [stretchToViewport, setStretchToViewport] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth;
      setStretchToViewport(w > 0 && w >= intrinsicWidthPx - 1);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, intrinsicWidthPx, result.columns]);

  const fillViewport = stretchToViewport;

  const gridTemplate = useMemo(
    () =>
      buildGridTemplate(
        rowNumColCh,
        columnTracks,
        fillViewport ? "stretch" : "scroll",
      ),
    [rowNumColCh, columnTracks, fillViewport],
  );

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
      {rowsTruncated && displayRowCap != null ? (
        <div class="border-b border-warn/40 bg-warn/10 px-4 py-2 font-mono text-[11px] leading-snug text-warn">
          Showing the first {displayRowCap.toLocaleString()} of{" "}
          {totalRowCount.toLocaleString()} rows in this grid. Lower{" "}
          <span class="text-text">sysparm_limit</span>, set{" "}
          <span class="text-text">sysparm_fields</span>, or use JDBC for very
          large extracts.
        </div>
      ) : null}
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          {resultLabel != null && resultLabel.trim() !== "" ? (
            <div class="flex shrink-0 items-center gap-2 font-mono text-[11px] text-subtle">
              <span class="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <span class="text-accent">{resultLabel}</span>
            </div>
          ) : null}
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
        style={
          scrollAreaMaxHeight != null
            ? { maxHeight: scrollAreaMaxHeight }
            : undefined
        }
      >
        <div
          class={cn(
            "inline-block min-w-full align-top",
            fillViewport ? "w-full" : "w-max",
          )}
        >
          <div
            role="row"
            class={cn(
              "sticky top-0 z-20 grid border-b border-border bg-surface-2 font-mono text-[12.5px]",
              fillViewport ? "w-full" : "w-max justify-start",
            )}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div
              role="columnheader"
              class="flex min-h-[2.5rem] items-center justify-end border-r border-border bg-surface-2 px-2 py-2 text-muted tabular-nums"
              aria-label="Row number"
            >
              #
            </div>
            {result.columns.map((column, index) => {
              const active = sort.columnIndex === index;
              return (
                <button
                  type="button"
                  key={`${column}-${index}`}
                  onClick={() => toggleSort(index)}
                  class={cn(
                    "flex min-h-[2.5rem] min-w-0 items-center justify-between gap-2 border-r border-border bg-surface-2 px-3 py-2 text-left",
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
                  <span class="min-w-0 flex-1 truncate">{column}</span>
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
            <div
              class={cn(
                "relative z-0 min-w-full",
                fillViewport ? "w-full" : "w-max",
              )}
              style={{ height: totalHeight }}
            >
              <div
                class={cn("min-w-full", fillViewport ? "w-full" : "w-max")}
                style={{ transform: `translateY(${paddingTop}px)` }}
              >
                {visible.map((row, offset) => {
                  const rowIndex = startIndex + offset;
                  return (
                    <div
                      role="row"
                      key={rowIndex}
                      class={cn(
                        "grid border-b border-border/60 font-mono text-[12.5px] text-text transition-colors",
                        fillViewport ? "w-full" : "w-max justify-start",
                        rowIndex % 2 === 1 ? "bg-bg/40" : "bg-code",
                        "hover:bg-accent-dim/40",
                      )}
                      style={{
                        gridTemplateColumns: gridTemplate,
                        height: ROW_HEIGHT,
                      }}
                    >
                      <div
                        role="cell"
                        class="flex items-center justify-end overflow-hidden border-r border-border/40 px-2 font-mono text-[12.5px] tabular-nums text-muted"
                        aria-label={`Row ${(rowIndex + 1).toLocaleString()}`}
                      >
                        {(rowIndex + 1).toLocaleString()}
                      </div>
                      {row.map((cell, columnIndex) => (
                        <div
                          role="cell"
                          key={columnIndex}
                          class="flex min-w-0 items-center overflow-hidden border-r border-border/40 px-3"
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          <span class="min-w-0 truncate">{renderCell(cell)}</span>
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
