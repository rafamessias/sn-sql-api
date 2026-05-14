import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Editor } from "./editor";
import { EditorTabsBar } from "./editor-tabs-bar";
import { ResultsTable } from "./results-table";
import { StatusBar } from "./status-bar";
import { isAbortError, runQuery, type QueryResult } from "../lib/api";
import { cn } from "../lib/cn";
import {
  downloadTextFile,
  sanitizeDownloadStem,
} from "../lib/download-text-file";
import { formatDurationMs, formatRunningClock } from "../lib/format-duration-ms";
import {
  clampEditorSectionMinHeightPx,
  persistEditorSectionMinHeightPx,
  readEditorSectionMinHeightPxFromStorage,
} from "../lib/editor-section-height";
import type { ConnectionPayload } from "../lib/connections";
import {
  clearQueryResultsByTabStorage,
  loadQueryResultsByTab,
  persistQueryResultsByTab,
} from "../lib/editor-query-results-storage";
import type { EditorTab } from "../lib/editor-tabs";

type Status =
  | { kind: "idle"; message: string }
  | { kind: "running"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string; copyText?: string };

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
  // Per-tab results, restored from localStorage so they survive console tab
  // switches and full reloads. Very large payloads may fail to persist (quota).
  const [resultsByTab, setResultsByTab] = useState<
    Record<string, QueryResult | null>
  >(() => loadQueryResultsByTab());
  const [statusByTab, setStatusByTab] = useState<Record<string, Status>>({});
  const [resultsExpandedByTab, setResultsExpandedByTab] = useState<
    Record<string, boolean>
  >({});
  const abortRefByTab = useRef<Map<string, AbortController>>(new Map());
  const runningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningForTabIdRef = useRef<string | null>(null);

  const [editorSectionMinHeightPx, setEditorSectionMinHeightPx] = useState(
    readEditorSectionMinHeightPxFromStorage,
  );

  const adjustEditorSectionMinHeight = useCallback((deltaPx: number) => {
    setEditorSectionMinHeightPx((prev) => {
      const next = clampEditorSectionMinHeightPx(prev + deltaPx);
      persistEditorSectionMinHeightPx(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = () => {
      setEditorSectionMinHeightPx((prev) => {
        const next = clampEditorSectionMinHeightPx(prev);
        if (next !== prev) persistEditorSectionMinHeightPx(next);
        return next;
      });
    };
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
  }, []);

  const clearRunningTimer = useCallback(() => {
    if (runningTimerRef.current !== null) {
      globalThis.clearInterval(runningTimerRef.current);
      runningTimerRef.current = null;
    }
    runningForTabIdRef.current = null;
  }, []);

  useEffect(() => () => clearRunningTimer(), [clearRunningTimer]);

  const tabIdsKey = useMemo(() => tabs.map((t) => t.id).join("|"), [tabs]);

  useEffect(() => {
    const tabIds = new Set(
      tabIdsKey.length > 0 ? tabIdsKey.split("|") : [],
    );
    setResultsByTab((prev) => {
      const next: Record<string, QueryResult | null> = {};
      for (const id of tabIds) {
        if (Object.prototype.hasOwnProperty.call(prev, id)) {
          next[id] = prev[id]!;
        }
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });
  }, [tabIdsKey]);

  useEffect(() => {
    const tabIds = new Set(
      tabIdsKey.length > 0 ? tabIdsKey.split("|") : [],
    );
    const filtered: Record<string, QueryResult | null> = {};
    for (const id of tabIds) {
      if (Object.prototype.hasOwnProperty.call(resultsByTab, id)) {
        filtered[id] = resultsByTab[id]!;
      }
    }
    persistQueryResultsByTab(filtered);
  }, [resultsByTab, tabIdsKey]);

  const hasStoredResults = useMemo(
    () => Object.values(resultsByTab).some(Boolean),
    [resultsByTab],
  );

  const result = resultsByTab[activeId] ?? null;
  const resultsExpanded = resultsExpandedByTab[activeId] ?? false;
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
      if (controller.signal.aborted || isAbortError(err)) {
        const elapsed = Math.round(performance.now() - started);
        setTabStatus({
          kind: "idle",
          message: `Stopped after ${formatDurationMs(elapsed)} · ${label}`,
        });
        return;
      }
      const elapsed = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTabResult(null);
      setTabStatus({
        kind: "error",
        message: `Error in ${formatDurationMs(elapsed)} — ${message}`,
        copyText: message,
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

  const handleStop = useCallback(() => {
    abortRefByTab.current.get(activeId)?.abort();
  }, [activeId]);

  const handleClear = useCallback(() => {
    abortRefByTab.current.get(activeId)?.abort();
    onActiveQueryChange("");
    setActiveResult(null);
    setResultsExpandedByTab((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
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

  const handleCopySql = useCallback(async () => {
    const text = activeTab.query;
    if (text.trim().length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      setActiveStatus({
        kind: "ok",
        message: `Copied query to clipboard (${text.length.toLocaleString()} chars).`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActiveStatus({ kind: "error", message: `Copy failed: ${message}` });
    }
  }, [activeTab.query, setActiveStatus]);

  const handleDownloadSql = useCallback(() => {
    const text = activeTab.query;
    if (text.trim().length === 0) return;
    const stem = sanitizeDownloadStem(activeTab.name);
    try {
      downloadTextFile(`${stem}.sql`, text, "application/sql;charset=utf-8");
      setActiveStatus({
        kind: "ok",
        message: `Downloaded ${stem}.sql.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActiveStatus({ kind: "error", message: `Download failed: ${message}` });
    }
  }, [activeTab.name, activeTab.query, setActiveStatus]);

  const handleDownloadTxt = useCallback(() => {
    const text = activeTab.query;
    if (text.trim().length === 0) return;
    const stem = sanitizeDownloadStem(activeTab.name);
    try {
      downloadTextFile(`${stem}.txt`, text);
      setActiveStatus({
        kind: "ok",
        message: `Downloaded ${stem}.txt.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActiveStatus({ kind: "error", message: `Download failed: ${message}` });
    }
  }, [activeTab.name, activeTab.query, setActiveStatus]);

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
      setResultsExpandedByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      onCloseTab(id);
    },
    [clearRunningTimer, onCloseTab],
  );

  const handleToggleResultsExpanded = useCallback(() => {
    setResultsExpandedByTab((prev) => ({
      ...prev,
      [activeId]: !(prev[activeId] ?? false),
    }));
  }, [activeId]);

  const handleClearStoredResults = useCallback(() => {
    clearQueryResultsByTabStorage();
    setResultsByTab({});
    setStatusByTab({});
    setResultsExpandedByTab({});
    setActiveStatus({
      kind: "ok",
      message: "Cleared saved result grids from this browser.",
    });
  }, [setActiveStatus]);

  const editorUnderlayHidden = Boolean(result && resultsExpanded);

  return (
    <section class="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4">
      <EditorTabsBar
        tabs={tabs}
        activeId={activeId}
        onSelect={onSelectTab}
        onClose={handleCloseTab}
        onRename={onRenameTab}
        onAdd={onAddTab}
      />

      <div class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {!result ? (
          <>
            <div
              class="flex min-h-0 min-w-0 flex-1 flex-col"
              style={{ minHeight: `${editorSectionMinHeightPx}px` }}
            >
              <Editor
                query={activeTab.query}
                onQueryChange={onActiveQueryChange}
                isRunning={status.kind === "running"}
                onRun={handleRun}
                onStop={handleStop}
                onClear={handleClear}
                onCopySql={handleCopySql}
                onDownloadSql={handleDownloadSql}
                onDownloadTxt={handleDownloadTxt}
                schemaTables={schemaTables}
                editorSectionMinHeightPx={editorSectionMinHeightPx}
                onAdjustEditorSectionHeight={adjustEditorSectionMinHeight}
              />
            </div>
            <div class="shrink-0 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div class="min-w-0 flex-1">
                <StatusBar
                  kind={status.kind}
                  message={status.message}
                  errorCopyText={
                    status.kind === "error"
                      ? (status.copyText ?? status.message)
                      : undefined
                  }
                />
              </div>
              {hasStoredResults ? (
                <button
                  type="button"
                  class="btn shrink-0 self-end px-2 py-0.5 text-[11px] text-muted sm:self-auto"
                  onClick={handleClearStoredResults}
                  title="Remove every saved result grid from localStorage (all query tabs)"
                >
                  Clear saved results
                </button>
              ) : null}
            </div>
            <div class="flex min-h-0 min-w-0 flex-[2] items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 text-sm text-muted">
              Run a query to see results here.
            </div>
          </>
        ) : (
          <>
            <div
              class={cn(
                "min-w-0 shrink-0",
                editorUnderlayHidden && "pointer-events-none select-none",
              )}
              style={{ minHeight: `${editorSectionMinHeightPx}px` }}
              aria-hidden={editorUnderlayHidden ? true : undefined}
            >
              <Editor
                query={activeTab.query}
                onQueryChange={onActiveQueryChange}
                isRunning={status.kind === "running"}
                onRun={handleRun}
                onStop={handleStop}
                onClear={handleClear}
                onCopySql={handleCopySql}
                onDownloadSql={handleDownloadSql}
                onDownloadTxt={handleDownloadTxt}
                schemaTables={schemaTables}
                editorSectionMinHeightPx={editorSectionMinHeightPx}
                onAdjustEditorSectionHeight={adjustEditorSectionMinHeight}
              />
            </div>

            <div
              class={cn(
                "shrink-0 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3",
                editorUnderlayHidden && "pointer-events-none",
              )}
              aria-hidden={editorUnderlayHidden ? true : undefined}
            >
              <div class="min-w-0 flex-1">
                <StatusBar
                  kind={status.kind}
                  message={status.message}
                  errorCopyText={
                    status.kind === "error"
                      ? (status.copyText ?? status.message)
                      : undefined
                  }
                />
              </div>
              {hasStoredResults ? (
                <button
                  type="button"
                  class="btn shrink-0 self-end px-2 py-0.5 text-[11px] text-muted sm:self-auto"
                  onClick={handleClearStoredResults}
                  title="Remove every saved result grid from localStorage (all query tabs)"
                >
                  Clear saved results
                </button>
              ) : null}
            </div>

            <div
              class={cn(
                "flex min-h-0 min-w-0 flex-col",
                resultsExpanded
                  ? "pointer-events-auto absolute left-1/2 top-0 z-50 flex h-full min-h-0 w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface shadow-2xl ring-1 ring-border sm:w-[calc(100vw-4rem)]"
                  : "relative flex-1 min-h-0",
              )}
            >
              <ResultsTable
                result={result}
                resultsExpanded={resultsExpanded}
                onToggleResultsExpanded={handleToggleResultsExpanded}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
};
