import { useCallback, useMemo, useState } from "preact/hooks";
import { useAppLogs } from "../hooks/use-app-logs";
import {
  appendAppLog,
  clearAppLogs,
  formatAppLogsAsText,
  type AppLogEntry,
  type AppLogLevel,
} from "../lib/app-logs";
import { downloadTextFile } from "../lib/download-text-file";
import { cn } from "../lib/cn";

const levelCellClass = (level: AppLogLevel): string =>
  cn(
    "whitespace-nowrap font-mono text-[11px] uppercase tracking-wide",
    level === "info" && "text-info",
    level === "success" && "text-accent",
    level === "warn" && "text-warn",
    level === "error" && "text-danger",
  );

const formatLocalTime = (ts: number): string => {
  try {
    return new Date(ts).toLocaleString(undefined, {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(ts);
  }
};

export const LogsPanel = () => {
  const entries = useAppLogs();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
  const textBody = useMemo(() => formatAppLogsAsText(entries), [entries]);

  const handleCopy = useCallback(async () => {
    if (entries.length === 0) return;
    try {
      await navigator.clipboard.writeText(textBody);
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAppLog({
        level: "error",
        category: "Logs",
        message: "Copy to clipboard failed",
        detail: msg,
      });
      setCopyState("err");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [entries.length, textBody]);

  const handleSaveTxt = useCallback(() => {
    if (entries.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const stem = `sn-sql-console-logs-${day}`;
    try {
      downloadTextFile(`${stem}.txt`, textBody);
      appendAppLog({
        level: "success",
        category: "Logs",
        message: `Saved ${stem}.txt (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAppLog({
        level: "error",
        category: "Logs",
        message: "Save failed",
        detail: msg,
      });
    }
  }, [entries.length, textBody]);

  const handleClear = useCallback(() => {
    clearAppLogs();
    appendAppLog({
      level: "info",
      category: "Logs",
      message: "Log cleared",
    });
  }, []);

  const copyLabel =
    copyState === "ok" ? "Copied" : copyState === "err" ? "Copy failed" : "Copy all";

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn"
          onClick={handleCopy}
          disabled={entries.length === 0}
          title="Copy the full log as plain text"
        >
          {copyLabel}
        </button>
        <button
          type="button"
          class="btn"
          onClick={handleSaveTxt}
          disabled={entries.length === 0}
          title="Download logs as a .txt file"
        >
          Save as .txt
        </button>
        <button
          type="button"
          class="btn"
          onClick={handleClear}
          title="Remove all entries (a fresh “Log cleared” line is added)"
        >
          Clear
        </button>
        <span class="ml-auto font-mono text-[11px] text-subtle">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · newest first
        </span>
      </div>

      <p class="font-mono text-[11px] leading-relaxed text-muted">
        SQL runs, schema calls, and network errors. Entries are
        kept in{" "}
        <code class="rounded border border-border bg-surface-2 px-1 py-0.5 text-[10px] text-info">
          localStorage
        </code>{" "}
        on this origin only (survives refresh; not sent to a server). Passwords
        and connection secrets are never written here—only endpoints, timings,
        and messages returned by the API.
      </p>

      <div class="min-h-[min(28rem,calc(100dvh-14rem))] flex-1 overflow-auto rounded-lg border border-border bg-surface">
        {entries.length === 0 ? (
          <p class="px-4 py-12 text-center font-mono text-[12px] text-muted">
            No events yet. Run a query, open Schema, or switch connections to
            populate this log.
          </p>
        ) : (
          <table class="w-full min-w-[640px] border-collapse text-left font-mono text-[12px]">
            <thead class="sticky top-0 z-[1] border-b border-border bg-surface-2 shadow-sm">
              <tr class="text-[10px] uppercase tracking-wider text-subtle">
                <th scope="col" class="w-[1%] whitespace-nowrap px-3 py-2">
                  Time
                </th>
                <th scope="col" class="w-[1%] whitespace-nowrap px-2 py-2">
                  Level
                </th>
                <th scope="col" class="w-[1%] whitespace-nowrap px-2 py-2">
                  Category
                </th>
                <th scope="col" class="px-2 py-2">
                  Message
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/70">
              {entries.map((row: AppLogEntry) => (
                <tr key={row.id} class="align-top hover:bg-surface-2/60">
                  <td class="whitespace-nowrap px-3 py-2 text-[11px] text-muted">
                    {formatLocalTime(row.ts)}
                  </td>
                  <td class="px-2 py-2">
                    <span class={levelCellClass(row.level)}>{row.level}</span>
                  </td>
                  <td class="whitespace-nowrap px-2 py-2 text-info">
                    {row.category}
                  </td>
                  <td class="max-w-0 px-2 py-2">
                    <div class="break-words text-text">{row.message}</div>
                    {row.detail && (
                      <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-bg/80 px-2 py-1.5 text-[11px] leading-snug text-muted">
                        {row.detail}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
