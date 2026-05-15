import type { QueryResult, TableApiRecordsResponse } from "../lib/api";
import { formatDurationMs } from "../lib/format-duration-ms";
import { cn } from "../lib/cn";

type TimingOnlySummaryProps = {
  result: QueryResult | TableApiRecordsResponse;
  label: string;
  /** Browser round-trip when known (JDBC UI timing). */
  browserMs?: number;
  class?: string;
};

export const TimingOnlySummary = ({
  result,
  label,
  browserMs,
  class: className,
}: TimingOnlySummaryProps) => {
  const tableApi =
    "duration_ms" in result && typeof result.duration_ms === "number"
      ? (result as TableApiRecordsResponse)
      : null;
  const serverMs =
    tableApi?.duration_ms ??
    (typeof result.duration_ms === "number" ? result.duration_ms : null);
  const matchCount = result.row_count;
  const rawTotalCount = tableApi?.total_count ?? null;

  return (
    <div
      class={cn(
        "flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-4",
        className,
      )}
    >
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <span class="h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <span class="font-medium text-info">Timing only</span>
        <span class="text-subtle">— {label}</span>
      </div>
      <dl class="grid gap-2 font-mono text-[12px] sm:grid-cols-2">
        <div>
          <dt class="text-subtle">Matching rows</dt>
          <dd class="text-text tabular-nums">
            {matchCount.toLocaleString()}
            {rawTotalCount != null && rawTotalCount !== matchCount ? (
              <span class="text-subtle">
                {" "}
                (X-Total-Count {rawTotalCount.toLocaleString()} before limit/offset)
              </span>
            ) : null}
          </dd>
        </div>
        {browserMs != null ? (
          <div>
            <dt class="text-subtle">Browser round-trip</dt>
            <dd class="text-text tabular-nums">{formatDurationMs(browserMs)}</dd>
          </div>
        ) : null}
        {serverMs != null ? (
          <div>
            <dt class="text-subtle">
              {tableApi ? "Instance (Table API)" : "Server (JDBC)"}
            </dt>
            <dd class="text-text tabular-nums">{formatDurationMs(serverMs)}</dd>
          </div>
        ) : null}
      </dl>
      {result.timing_note ? (
        <p class="font-mono text-[11px] leading-snug text-muted">
          {result.timing_note}
        </p>
      ) : null}
      <p class="font-mono text-[11px] leading-snug text-subtle">
        Full instance fetch completed; row data was not sent to this browser.
        Uncheck timing only and run again to load the grid.
      </p>
    </div>
  );
};
