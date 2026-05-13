import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Editor } from "./editor";
import { EditorTabsBar } from "./editor-tabs-bar";
import { ResultsTable } from "./results-table";
import { StatusBar } from "./status-bar";
import { runQuery, type QueryResult } from "../lib/api";
import { resultToCsv } from "../lib/csv";
import { formatDurationMs, formatRunningClock } from "../lib/format-duration-ms";
import type { ConnectionPayload } from "../lib/connections";
import type { EditorTab } from "../lib/editor-tabs";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "running"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

const INITIAL_STATUS: Status = { kind: "idle", message: "Ready." };

type EditorPanelProps = {
  tabs: EditorTab[];
  activeId: string;
  activeTab: EditorTab;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onAddTab: () => void;
  onActiveQueryChange: (next: string) => void;
  onLastSuccessfulRunDuration?: (tabId: string, durationMs: number) => void;
  connectionPayload: ConnectionPayload | undefined;
  connectionLabel: string;
  schemaTables?: readonly string[];
};

export const EditorPanel = ({
  tabs,
  activeId,
  activeTab,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onAddTab,
  onActiveQueryChange,
  onLastSuccessfulRunDuration,
  connectionPayload,
  connectionLabel,
  schemaTables,
}: EditorPanelProps) => {
  // Per-tab runtime state. Results are session-scoped (in-memory only) so we
  // don't blow past localStorage quotas with large datasets.
  const [resultsByTab, setResultsByTab] = useState<
    Record<string, QueryResult | null>
  >({});
  const [statusByTab, setStatusByTab] = useState<Record<string, Status>>({});
  const abortRefByTab = useRef<Map<string, AbortController>>(new Map());
  const runningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningForTabIdRef = useRef<string | null>(null);

  const clearRunningTimer = useCallback(() => {
    if (runningTimerRef.current !== null) {
      globalThis.clearInterval(runningTimerRef.current);
      runningTimerRef.current = null;
    }
    runningForTabIdRef.current = null;
  }, []);

  useEffect(() => () => clearRunningTimer(), [clearRunningTimer]);

  const result = resultsByTab[activeId] ?? null;
  const statusFromMemory = statusByTab[activeId];
  const status =
    statusFromMemory ??
    (activeTab.lastRunDurationMs != null
      ? {
          kind: "idle" as const,
          message: `Ready. Last run: ${formatDurationMs(activeTab.lastRunDurationMs)}.`,
        }
      : INITIAL_STATUS);

  const setActiveResult = useCallback(
    (next: QueryResult | null) => {
      setResultsByTab((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const setActiveStatus = useCallback(
    (next: Status) => {
      setStatusByTab((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const handleRun = useCallback(async () => {
    const trimmed = activeTab.query.trim();
    if (trimmed.length === 0) {
      setActiveStatus({ kind: "error", message: "Type a query first." });
      return;
    }

    const tabId = activeId;
    const label = connectionLabel;

    abortRefByTab.current.get(tabId)?.abort();
    const controller = new AbortController();
    abortRefByTab.current.set(tabId, controller);

    clearRunningTimer();

    const setTabStatus = (next: Status) => {
      setStatusByTab((prev) => ({ ...prev, [tabId]: next }));
    };
    const setTabResult = (next: QueryResult | null) => {
      setResultsByTab((prev) => ({ ...prev, [tabId]: next }));
    };

    const started = performance.now();
    runningForTabIdRef.current = tabId;

    const tickRunningMessage = () => {
      const elapsed = performance.now() - started;
      setTabStatus({
        kind: "running",
        message: `Running against ${label}… (${formatRunningClock(elapsed)})`,
      });
    };
    tickRunningMessage();
    runningTimerRef.current = globalThis.setInterval(tickRunningMessage, 250);

    try {
      const data = await runQuery(
        trimmed,
        connectionPayload,
        null,
        controller.signal,
      );
      const elapsed = Math.round(performance.now() - started);
      setTabResult(data);
      onLastSuccessfulRunDuration?.(tabId, elapsed);
      setTabStatus({
        kind: "ok",
        message: `${data.row_count.toLocaleString()} row(s) in ${formatDurationMs(elapsed)} · ${label}`,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const elapsed = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTabResult(null);
      setTabStatus({
        kind: "error",
        message: `Error in ${formatDurationMs(elapsed)} — ${message}`,
      });
    } finally {
      clearRunningTimer();
    }
  }, [
    activeTab.query,
    activeId,
    connectionLabel,
    connectionPayload,
    clearRunningTimer,
    onLastSuccessfulRunDuration,
    setActiveStatus,
  ]);

  const handleClear = useCallback(() => {
    abortRefByTab.current.get(activeId)?.abort();
    onActiveQueryChange("");
    setActiveResult(null);
    setActiveStatus(
      activeTab.lastRunDurationMs != null
        ? {
            kind: "idle",
            message: `Ready. Last run: ${formatDurationMs(activeTab.lastRunDurationMs)}.`,
          }
        : INITIAL_STATUS,
    );
  }, [
    activeId,
    activeTab.lastRunDurationMs,
    onActiveQueryChange,
    setActiveResult,
    setActiveStatus,
  ]);

  const handleCopyCsv = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resultToCsv(result));
      setActiveStatus({
        kind: "ok",
        message: `Copied ${result.row_count.toLocaleString()} row(s) as CSV.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActiveStatus({ kind: "error", message: `Copy failed: ${message}` });
    }
  }, [result, setActiveStatus]);

  // When a tab is closed, drop its runtime state to free memory.
  const handleCloseTab = useCallback(
    (id: string) => {
      if (runningForTabIdRef.current === id) {
        clearRunningTimer();
      }
      abortRefByTab.current.get(id)?.abort();
      abortRefByTab.current.delete(id);
      setResultsByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setStatusByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      onCloseTab(id);
    },
    [clearRunningTimer, onCloseTab],
  );

  return (
    <section class="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-4">
      <EditorTabsBar
        tabs={tabs}
        activeId={activeId}
        onSelect={onSelectTab}
        onClose={handleCloseTab}
        onRename={onRenameTab}
        onAdd={onAddTab}
      />

      <Editor
        query={activeTab.query}
        onQueryChange={onActiveQueryChange}
        isRunning={status.kind === "running"}
        canExport={result !== null && result.row_count > 0}
        onRun={handleRun}
        onClear={handleClear}
        onCopyCsv={handleCopyCsv}
        schemaTables={schemaTables}
      />

      <StatusBar kind={status.kind} message={status.message} />

      {result ? (
        <ResultsTable result={result} />
      ) : (
        <div class="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 text-sm text-muted">
          Run a query to see results here.
        </div>
      )}
    </section>
  );
};
