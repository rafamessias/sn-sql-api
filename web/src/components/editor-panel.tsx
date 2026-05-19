import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Editor } from "./editor";
import { EditorTabsBar } from "./editor-tabs-bar";
import {
  RESULTS_TABLE_MAX_DISPLAY_ROWS,
  ResultsTable,
} from "./results-table";
import { StatusBar } from "./status-bar";
import { isAbortError, runQuery, runTableApiRecords, type QueryResult, type TableApiRecordsResponse } from "../lib/api";
import { cn } from "../lib/cn";
import { copyTextToClipboard } from "../lib/copy-text";
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
import {
  clearTableApiResultsByTabStorage,
  loadTableApiFormsByTab,
  loadTableApiResultsByTab,
  persistTableApiFormsByTab,
  persistTableApiResultsByTab,
} from "../lib/editor-table-api-storage";
import type { EditorTab } from "../lib/editor-tabs";
import {
  defaultTableApiForm,
  type TableApiFormState,
} from "../lib/table-api-form";
import { scheduleHeavyUpdate } from "../lib/defer-heavy-update";
import { filterQueryResultsForPersist } from "../lib/result-persist-limits";
import { showToast } from "../lib/toast";
import { TableApiComparePanel } from "./table-api-compare-panel";
import { TimingOnlySummary } from "./timing-only-summary";

const HEAVY_RESULT_ROW_THRESHOLD = 300;

const isHeavyResult = (data: QueryResult): boolean =>
  data.row_count > HEAVY_RESULT_ROW_THRESHOLD ||
  data.rows.length > HEAVY_RESULT_ROW_THRESHOLD;

const setQueryResultState = <T extends QueryResult>(
  setter: (next: T | null) => void,
  data: T | null,
): void => {
  if (data === null || !isHeavyResult(data)) {
    setter(data);
    return;
  }
  scheduleHeavyUpdate(() => setter(data));
};

type Status =
  | { kind: "idle"; message: string }
  | { kind: "running"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string; copyText?: string };

const INITIAL_STATUS: Status = { kind: "idle", message: "Ready." };

const INITIAL_TABLE_API_STATUS: Status = {
  kind: "idle",
  message: "Table API idle.",
};

/** Shown as native tooltip on the JDBC status line (explains the single duration). */
const JDBC_STATUS_TIME_TOOLTIP =
  "One duration: full round-trip in this browser (UI → this API → JDBC on the server → rows back). The API does not return a separate server-only JDBC time.";

/** Shown as native tooltip on the Table API status line (browser vs instance vs X-Total-Count). */
const TABLE_API_STATUS_TIME_TOOLTIP =
  "Browser: full round-trip in this browser for this request. Instance: time for this API to call ServiceNow’s Table API. X-Total-Count (when shown): ServiceNow header = rows matching your filter, often larger than the rows on this page.";

type CompareFastLane = "jdbc" | "rest" | "tie";

async function timedRequest<T>(
  fn: () => Promise<T>,
): Promise<
  | { ok: true; value: T; ms: number }
  | { ok: false; reason: unknown; ms: number }
> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Math.round(performance.now() - t0) };
  } catch (reason) {
    return { ok: false, reason, ms: Math.round(performance.now() - t0) };
  }
}

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
  /** Persist last successful Table API timings on the tab (browser + instance ms). */
  onLastSuccessfulTableApiRun?: (
    tabId: string,
    browserMs: number,
    instanceMs: number,
  ) => void;
  /** Split JDBC + Table API layout for the active tab (stored on the tab). */
  onCompareTableApiChange: (enabled: boolean) => void;
  onTimingOnlyChange: (enabled: boolean) => void;
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
  onLastSuccessfulTableApiRun,
  onCompareTableApiChange,
  onTimingOnlyChange,
  connectionPayload,
  connectionLabel,
  schemaTables,
}: EditorPanelProps) => {
  const compareMode = activeTab.compareTableApi === true;

  // Per-tab results, restored from localStorage so they survive console tab
  // switches and full reloads. Very large payloads may fail to persist (quota).
  const [resultsByTab, setResultsByTab] = useState<
    Record<string, QueryResult | null>
  >(() => loadQueryResultsByTab());
  const [statusByTab, setStatusByTab] = useState<Record<string, Status>>({});
  const [resultsExpandedByTab, setResultsExpandedByTab] = useState<
    Record<string, boolean>
  >({});
  const [tableApiFormByTab, setTableApiFormByTab] = useState<
    Record<string, TableApiFormState>
  >(() => loadTableApiFormsByTab());
  const [tableApiResultsByTab, setTableApiResultsByTab] = useState<
    Record<string, TableApiRecordsResponse | null>
  >(() => loadTableApiResultsByTab());
  const [tableApiStatusByTab, setTableApiStatusByTab] = useState<
    Record<string, Status>
  >({});
  const [tableApiBusyByTab, setTableApiBusyByTab] = useState<
    Record<string, boolean>
  >({});
  const [compareFastLaneByTab, setCompareFastLaneByTab] = useState<
    Record<string, CompareFastLane | null>
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
    persistQueryResultsByTab(filterQueryResultsForPersist(filtered));
  }, [resultsByTab, tabIdsKey]);

  useEffect(() => {
    const tabIds = new Set(
      tabIdsKey.length > 0 ? tabIdsKey.split("|") : [],
    );
    setTableApiFormByTab((prev) => {
      const next: Record<string, TableApiFormState> = {};
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
    setTableApiResultsByTab((prev) => {
      const next: Record<string, TableApiRecordsResponse | null> = {};
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
    const filtered: Record<string, TableApiFormState> = {};
    for (const id of tabIds) {
      if (Object.prototype.hasOwnProperty.call(tableApiFormByTab, id)) {
        filtered[id] = tableApiFormByTab[id]!;
      }
    }
    persistTableApiFormsByTab(filtered);
  }, [tableApiFormByTab, tabIdsKey]);

  useEffect(() => {
    const tabIds = new Set(
      tabIdsKey.length > 0 ? tabIdsKey.split("|") : [],
    );
    const filtered: Record<string, TableApiRecordsResponse | null> = {};
    for (const id of tabIds) {
      if (Object.prototype.hasOwnProperty.call(tableApiResultsByTab, id)) {
        filtered[id] = tableApiResultsByTab[id]!;
      }
    }
    persistTableApiResultsByTab(filterQueryResultsForPersist(filtered));
  }, [tableApiResultsByTab, tabIdsKey]);

  const hasStoredResults = useMemo(
    () =>
      Object.values(resultsByTab).some(Boolean) ||
      Object.values(tableApiResultsByTab).some(Boolean),
    [resultsByTab, tableApiResultsByTab],
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

  const tableApiForm = useMemo(
    () => tableApiFormByTab[activeId] ?? defaultTableApiForm(),
    [tableApiFormByTab, activeId],
  );

  const tableApiResult = tableApiResultsByTab[activeId] ?? null;
  const tableApiStatusFromMemory = tableApiStatusByTab[activeId];
  const tableApiStatusIdleFromTab: Status | null =
    activeTab.lastTableApiBrowserMs != null &&
    activeTab.lastTableApiInstanceMs != null
      ? {
          kind: "idle",
          message: `Ready. Last run: browser ${formatDurationMs(activeTab.lastTableApiBrowserMs)} · instance ${formatDurationMs(activeTab.lastTableApiInstanceMs)}.`,
        }
      : null;
  const tableApiStatus =
    tableApiStatusFromMemory ??
    tableApiStatusIdleFromTab ??
    INITIAL_TABLE_API_STATUS;
  const tableApiBusy = tableApiBusyByTab[activeId] ?? false;

  const compareFastLane = compareFastLaneByTab[activeId] ?? null;

  const jdbcCompareBadge = useMemo(() => {
    if (!compareMode) return null;
    if (compareFastLane === "jdbc" && status.kind === "ok") return "Faster";
    if (
      compareFastLane === "tie" &&
      status.kind === "ok" &&
      tableApiStatus.kind === "ok"
    ) {
      return "Tie";
    }
    return null;
  }, [compareMode, compareFastLane, status.kind, tableApiStatus.kind]);

  const restCompareBadge = useMemo(() => {
    if (!compareMode) return null;
    if (compareFastLane === "rest" && tableApiStatus.kind === "ok")
      return "Faster";
    if (
      compareFastLane === "tie" &&
      status.kind === "ok" &&
      tableApiStatus.kind === "ok"
    ) {
      return "Tie";
    }
    return null;
  }, [compareMode, compareFastLane, status.kind, tableApiStatus.kind]);

  const showAnyResult =
    Boolean(result) ||
    Boolean(compareMode && tableApiResult) ||
    Boolean(compareMode && tableApiBusy);

  const setActiveResult = useCallback(
    (next: QueryResult | null) => {
      setResultsByTab((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const setActiveTableApiStatus = useCallback(
    (next: Status) => {
      setTableApiStatusByTab((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const setActiveStatus = useCallback(
    (next: Status) => {
      setStatusByTab((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const handleTableApiTranslateNotice = useCallback((message: string) => {
    showToast(message, "ok");
  }, []);

  const buildTableApiRequestBody = useCallback(
    (form: TableApiFormState): Parameters<typeof runTableApiRecords>[0] => {
      const lim = Number.parseInt(form.sysparm_limit.trim(), 10);
      const off = Number.parseInt(form.sysparm_offset.trim(), 10);
      return {
        table: form.table.trim(),
        connection: connectionPayload,
        sysparm_query: form.sysparm_query.trim() || undefined,
        sysparm_fields: form.sysparm_fields.trim() || undefined,
        sysparm_limit: Number.isFinite(lim) && lim > 0 ? lim : undefined,
        sysparm_offset: Number.isFinite(off) && off >= 0 ? off : undefined,
        sysparm_display_value: form.sysparm_display_value || undefined,
        sysparm_exclude_reference_link: form.sysparm_exclude_reference_link
          ? true
          : undefined,
        sysparm_view: form.sysparm_view.trim() || undefined,
        sysparm_suppress_pagination_header: form.sysparm_suppress_pagination_header
          ? true
          : undefined,
        timing_only: activeTab.timingOnly === true ? true : undefined,
      };
    },
    [activeTab.timingOnly, connectionPayload],
  );

  const formatJdbcOkMessage = (
    data: QueryResult,
    browserMs: number,
    label: string,
  ): string => {
    if (data.timing_only) {
      const server =
        data.duration_ms != null
          ? ` · server ${formatDurationMs(data.duration_ms)}`
          : "";
      return `${data.row_count.toLocaleString()} row(s) (timing only)${server} · browser ${formatDurationMs(browserMs)} · ${label}`;
    }
    return `${data.row_count.toLocaleString()} row(s) in ${formatDurationMs(browserMs)} · ${label}`;
  };

  const formatTableApiOkMessage = (
    data: TableApiRecordsResponse,
    browserMs: number,
    label: string,
  ): string => {
    const totalHint =
      data.total_count != null
        ? ` · X-Total-Count ${data.total_count.toLocaleString()}`
        : "";
    if (data.timing_only) {
      return `${data.row_count.toLocaleString()} row(s) (timing only) · instance ${data.duration_ms}ms · browser ${formatDurationMs(browserMs)}${totalHint} · ${label}`;
    }
    return `${data.row_count.toLocaleString()} row(s) · instance ${data.duration_ms}ms · browser ${formatDurationMs(browserMs)}${totalHint} · ${label}`;
  };

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
    setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: false }));
    setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));

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
        { timingOnly: activeTab.timingOnly === true },
      );
      const elapsed = Math.round(performance.now() - started);
      setTabStatus({
        kind: "ok",
        message: formatJdbcOkMessage(data, elapsed, label),
      });
      setQueryResultState(setTabResult, data);
      onLastSuccessfulRunDuration?.(tabId, elapsed);
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
      setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: false }));
    }
  }, [
    activeTab.query,
    activeId,
    connectionLabel,
    connectionPayload,
    clearRunningTimer,
    onLastSuccessfulRunDuration,
    activeTab.timingOnly,
  ]);

  const handleRunTableApi = useCallback(async () => {
    const form = tableApiFormByTab[activeId] ?? defaultTableApiForm();
    if (!form.table.trim()) {
      setActiveTableApiStatus({
        kind: "error",
        message: "Set a table API name before running the Table API.",
      });
      return;
    }

    const tabId = activeId;
    const label = connectionLabel;

    abortRefByTab.current.get(tabId)?.abort();
    const controller = new AbortController();
    abortRefByTab.current.set(tabId, controller);
    setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));

    clearRunningTimer();

    const setTabTableStatus = (next: Status) => {
      setTableApiStatusByTab((prev) => ({ ...prev, [tabId]: next }));
    };
    const setTabTableResult = (next: TableApiRecordsResponse | null) => {
      setTableApiResultsByTab((prev) => ({ ...prev, [tabId]: next }));
    };

    const started = performance.now();
    setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: true }));

    const tickRunningMessage = () => {
      const elapsed = performance.now() - started;
      setTabTableStatus({
        kind: "running",
        message: `Table API ${label}… (${formatRunningClock(elapsed)})`,
      });
    };
    tickRunningMessage();
    runningTimerRef.current = globalThis.setInterval(tickRunningMessage, 250);
    runningForTabIdRef.current = tabId;

    try {
      const data = await runTableApiRecords(
        buildTableApiRequestBody(form),
        null,
        controller.signal,
      );
      const clientMs = Math.round(performance.now() - started);
      setTabTableStatus({
        kind: "ok",
        message: formatTableApiOkMessage(data, clientMs, label),
      });
      setQueryResultState(setTabTableResult, data);
      onLastSuccessfulTableApiRun?.(tabId, clientMs, data.duration_ms);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        const elapsed = Math.round(performance.now() - started);
        setTabTableStatus({
          kind: "idle",
          message: `Table API stopped after ${formatDurationMs(elapsed)} · ${label}`,
        });
        return;
      }
      const elapsed = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTabTableResult(null);
      setTabTableStatus({
        kind: "error",
        message: `Table API error in ${formatDurationMs(elapsed)} — ${message}`,
        copyText: message,
      });
    } finally {
      clearRunningTimer();
      runningForTabIdRef.current = null;
      setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: false }));
    }
  }, [
    activeId,
    buildTableApiRequestBody,
    clearRunningTimer,
    connectionLabel,
    onLastSuccessfulTableApiRun,
    tableApiFormByTab,
  ]);

  const handleRunBoth = useCallback(async () => {
    const trimmed = activeTab.query.trim();
    const form = tableApiFormByTab[activeId] ?? defaultTableApiForm();
    if (!trimmed) {
      setActiveStatus({ kind: "error", message: "Type a JDBC query first." });
      return;
    }
    if (!form.table.trim()) {
      setActiveStatus({
        kind: "error",
        message: "Set a Table API name (right panel) before comparing.",
      });
      return;
    }

    const tabId = activeId;
    const label = connectionLabel;

    abortRefByTab.current.get(tabId)?.abort();
    const controller = new AbortController();
    abortRefByTab.current.set(tabId, controller);
    setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));

    clearRunningTimer();

    const setTabStatus = (next: Status) => {
      setStatusByTab((prev) => ({ ...prev, [tabId]: next }));
    };
    const setTabResult = (next: QueryResult | null) => {
      setResultsByTab((prev) => ({ ...prev, [tabId]: next }));
    };
    const setTabTableStatus = (next: Status) => {
      setTableApiStatusByTab((prev) => ({ ...prev, [tabId]: next }));
    };
    const setTabTableResult = (next: TableApiRecordsResponse | null) => {
      setTableApiResultsByTab((prev) => ({ ...prev, [tabId]: next }));
    };

    runningForTabIdRef.current = tabId;
    setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: false }));

    const applyStopped = (jdbcElapsedMs: number, restElapsedMs?: number) => {
      setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));
      setTabStatus({
        kind: "idle",
        message: `Stopped after ${formatDurationMs(jdbcElapsedMs)} · ${label}`,
      });
      if (restElapsedMs != null) {
        setTabTableStatus({
          kind: "idle",
          message: `Stopped after ${formatDurationMs(restElapsedMs)} · ${label}`,
        });
      }
    };

    const jdbcStarted = performance.now();

    const tickJdbcRunning = () => {
      const elapsed = performance.now() - jdbcStarted;
      setTabStatus({
        kind: "running",
        message: `JDBC ${label}… (${formatRunningClock(elapsed)})`,
      });
    };
    tickJdbcRunning();
    runningTimerRef.current = globalThis.setInterval(tickJdbcRunning, 250);

    try {
      const jdbcR = await timedRequest(() =>
        runQuery(trimmed, connectionPayload, null, controller.signal, {
          timingOnly: activeTab.timingOnly === true,
        }),
      );

      clearRunningTimer();

      if (controller.signal.aborted) {
        applyStopped(Math.round(performance.now() - jdbcStarted));
        return;
      }

      if (jdbcR.ok) {
        setTabStatus({
          kind: "ok",
          message: formatJdbcOkMessage(jdbcR.value, jdbcR.ms, label),
        });
        setQueryResultState(setTabResult, jdbcR.value);
        onLastSuccessfulRunDuration?.(tabId, jdbcR.ms);
      } else {
        setTabResult(null);
        const jdbcErr =
          jdbcR.reason instanceof Error
            ? jdbcR.reason.message
            : String(jdbcR.reason);
        setTabStatus({
          kind: "error",
          message: `Error after ${formatDurationMs(jdbcR.ms)} — ${jdbcErr}`,
          copyText: jdbcErr,
        });
        setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));
        return;
      }

      setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: true }));
      const restStarted = performance.now();

      const tickRestRunning = () => {
        const elapsed = performance.now() - restStarted;
        setTabTableStatus({
          kind: "running",
          message: `Table API ${label}… (${formatRunningClock(elapsed)})`,
        });
      };
      tickRestRunning();
      runningTimerRef.current = globalThis.setInterval(tickRestRunning, 250);

      const restR = await timedRequest(() =>
        runTableApiRecords(
          buildTableApiRequestBody(form),
          null,
          controller.signal,
        ),
      );

      clearRunningTimer();

      if (controller.signal.aborted) {
        applyStopped(
          jdbcR.ms,
          Math.round(performance.now() - restStarted),
        );
        return;
      }

      if (restR.ok) {
        setTabTableStatus({
          kind: "ok",
          message: formatTableApiOkMessage(restR.value, restR.ms, label),
        });
        setQueryResultState(setTabTableResult, restR.value);
        onLastSuccessfulTableApiRun?.(
          tabId,
          restR.ms,
          restR.value.duration_ms,
        );
      } else {
        setTabTableResult(null);
        const restErr =
          restR.reason instanceof Error
            ? restR.reason.message
            : String(restR.reason);
        setTabTableStatus({
          kind: "error",
          message: `Error after ${formatDurationMs(restR.ms)} — ${restErr}`,
          copyText: restErr,
        });
      }

      let fast: CompareFastLane | null = null;
      if (jdbcR.ok && restR.ok) {
        if (jdbcR.ms < restR.ms) {
          fast = "jdbc";
        } else if (restR.ms < jdbcR.ms) {
          fast = "rest";
        } else {
          fast = "tie";
        }
      }
      setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: fast }));
    } catch (err) {
      clearRunningTimer();
      if (controller.signal.aborted || isAbortError(err)) {
        applyStopped(Math.round(performance.now() - jdbcStarted));
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setCompareFastLaneByTab((prev) => ({ ...prev, [tabId]: null }));
      setTabStatus({
        kind: "error",
        message,
        copyText: message,
      });
      setTabTableStatus({
        kind: "error",
        message,
        copyText: message,
      });
    } finally {
      clearRunningTimer();
      runningForTabIdRef.current = null;
      setTableApiBusyByTab((prev) => ({ ...prev, [tabId]: false }));
    }
  }, [
    activeId,
    activeTab.query,
    activeTab.timingOnly,
    buildTableApiRequestBody,
    clearRunningTimer,
    connectionLabel,
    connectionPayload,
    onLastSuccessfulRunDuration,
    onLastSuccessfulTableApiRun,
    tableApiFormByTab,
  ]);

  const handleToggleCompareMode = useCallback(
    (next: boolean) => {
      onCompareTableApiChange(next);
    },
    [onCompareTableApiChange],
  );

  const handleStop = useCallback(() => {
    abortRefByTab.current.get(activeId)?.abort();
    setTableApiBusyByTab((prev) => ({ ...prev, [activeId]: false }));
  }, [activeId]);

  const handleClear = useCallback(() => {
    abortRefByTab.current.get(activeId)?.abort();
    onActiveQueryChange("");
    setActiveResult(null);
    setTableApiResultsByTab((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
    setTableApiStatusByTab((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
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
    setCompareFastLaneByTab((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [
    activeId,
    activeTab.lastRunDurationMs,
    activeTab.lastTableApiBrowserMs,
    activeTab.lastTableApiInstanceMs,
    onActiveQueryChange,
    setActiveResult,
    setActiveStatus,
  ]);

  const handleCopySql = useCallback(async () => {
    const text = activeTab.query;
    if (text.trim().length === 0) return;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      showToast(
        `Copied query to clipboard (${text.length.toLocaleString()} chars).`,
        "ok",
      );
    } else {
      showToast(
        "Could not copy to clipboard. Use HTTPS, allow clipboard access, or copy manually.",
        "error",
      );
    }
  }, [activeTab.query]);

  const handleDownloadTxt = useCallback(() => {
    const text = activeTab.query;
    if (text.trim().length === 0) return;
    const stem = sanitizeDownloadStem(activeTab.name);
    try {
      downloadTextFile(`${stem}.txt`, text);
      showToast(`Downloaded ${stem}.txt.`, "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Download failed: ${message}`, "error");
    }
  }, [activeTab.name, activeTab.query]);

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
      setTableApiFormByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTableApiResultsByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTableApiStatusByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTableApiBusyByTab((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setCompareFastLaneByTab((prev) => {
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

  useEffect(() => {
    setResultsExpandedByTab((prev) => {
      if (!(activeId in prev) || !prev[activeId]) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [activeId, compareMode, activeTab.timingOnly]);

  const handleClearStoredResults = useCallback(() => {
    clearQueryResultsByTabStorage();
    clearTableApiResultsByTabStorage();
    setResultsByTab({});
    setStatusByTab({});
    setResultsExpandedByTab({});
    setTableApiResultsByTab({});
    setTableApiStatusByTab({});
    setCompareFastLaneByTab({});
    setActiveStatus({
      kind: "ok",
      message: "Cleared saved result grids from this browser.",
    });
  }, [setActiveStatus]);

  const isTimingOnlyResult = (r: QueryResult | null | undefined): boolean =>
    Boolean(r?.timing_only);

  const isDualJdbcRest =
    compareMode &&
    Boolean(result) &&
    Boolean(tableApiResult) &&
    !isTimingOnlyResult(result) &&
    !isTimingOnlyResult(tableApiResult);
  const showExpandedOverlay = Boolean(
    result &&
      resultsExpanded &&
      !isDualJdbcRest &&
      !isTimingOnlyResult(result),
  );
  const editorUnderlayHidden = showExpandedOverlay;

  const renderJdbcResultPane = (
    data: QueryResult,
    opts?: {
      resultsExpanded?: boolean;
      onToggleResultsExpanded?: () => void;
      browserMs?: number;
    },
  ) => {
    if (isTimingOnlyResult(data)) {
      return (
        <TimingOnlySummary
          result={data}
          label={`JDBC · ${connectionLabel}`}
          browserMs={opts?.browserMs}
        />
      );
    }
    return (
      <ResultsTable
        result={data}
        resultsExpanded={opts?.resultsExpanded ?? false}
        onToggleResultsExpanded={opts?.onToggleResultsExpanded}
        maxVisibleDataRows={opts?.resultsExpanded ? null : undefined}
        maxDisplayRows={
          compareMode ? RESULTS_TABLE_MAX_DISPLAY_ROWS : undefined
        }
      />
    );
  };

  const renderTableApiResultPane = (
    data: TableApiRecordsResponse,
    browserMs?: number,
  ) => {
    if (isTimingOnlyResult(data)) {
      return (
        <TimingOnlySummary
          result={data}
          label={`Table API · ${connectionLabel}`}
          browserMs={browserMs}
        />
      );
    }
    return (
      <ResultsTable
        result={data}
        resultsExpanded={false}
        maxDisplayRows={RESULTS_TABLE_MAX_DISPLAY_ROWS}
      />
    );
  };

  const editorCommonProps = {
    query: activeTab.query,
    onQueryChange: onActiveQueryChange,
    isRunning: status.kind === "running" || tableApiBusy,
    onRun: handleRun,
    onStop: handleStop,
    onClear: handleClear,
    onCopySql: handleCopySql,
    onDownloadTxt: handleDownloadTxt,
    schemaTables,
    editorSectionMinHeightPx,
    onAdjustEditorSectionHeight: adjustEditorSectionMinHeight,
  };

  return (
    <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div class="flex shrink-0 flex-col gap-2">
        <EditorTabsBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelectTab}
          onClose={handleCloseTab}
          onRename={onRenameTab}
          onAdd={onAddTab}
        />
        <div class="flex flex-wrap items-center gap-2">
          <label class="inline-flex cursor-pointer select-none items-center gap-2 rounded-md border border-border/60 bg-surface-2/80 px-3 py-2 text-[12px] text-muted hover:border-border">
            <input
              type="checkbox"
              class="rounded border-border"
              checked={compareMode}
              onChange={(e) =>
                handleToggleCompareMode((e.target as HTMLInputElement).checked)
              }
            />
            Split view: compare JDBC with Table API (REST)
          </label>
          <label
            class="inline-flex cursor-pointer select-none items-center gap-2 rounded-md border border-border/60 bg-surface-2/80 px-3 py-2 text-[12px] text-muted hover:border-border"
            title="Full instance fetch with your query/sysparms; returns counts and timing only (no result grid in the browser)"
          >
            <input
              type="checkbox"
              class="rounded border-border"
              checked={activeTab.timingOnly === true}
              disabled={status.kind === "running" || tableApiBusy}
              onChange={(e) =>
                onTimingOnlyChange((e.target as HTMLInputElement).checked)
              }
            />
            Timing only (no rows)
          </label>
        </div>
      </div>

      <div class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {!showAnyResult ? (
          <>
            <div
              class={cn(
                "grid min-h-0 min-w-0 flex-1 gap-3",
                compareMode ? "xl:grid-cols-2" : "grid-cols-1",
              )}
              style={{ minHeight: `${editorSectionMinHeightPx}px` }}
            >
              <Editor {...editorCommonProps} />
              {compareMode ? (
                <TableApiComparePanel
                  sqlText={activeTab.query}
                  form={tableApiForm}
                  connectionPayload={connectionPayload}
                  onFormChange={(next) =>
                    setTableApiFormByTab((prev) => ({
                      ...prev,
                      [activeId]: next,
                    }))
                  }
                  onRunRest={handleRunTableApi}
                  onStopRest={handleStop}
                  onRunBoth={handleRunBoth}
                  onTranslateNotice={handleTableApiTranslateNotice}
                  onApplyApproximateSqlToJdbc={onActiveQueryChange}
                  restRunning={tableApiBusy}
                  jdbcRunning={status.kind === "running"}
                  disableRestRun={false}
                />
              ) : null}
            </div>
            <div class="flex min-h-0 w-full flex-col gap-2 shrink-0">
              <div
                class={cn(
                  "grid min-w-0 w-full gap-3",
                  compareMode ? "xl:grid-cols-2" : "grid-cols-1",
                )}
              >
                <div class="flex min-w-0 flex-col">
                  <StatusBar
                    kind={status.kind}
                    message={status.message}
                    messageTooltip={JDBC_STATUS_TIME_TOOLTIP}
                    badge={jdbcCompareBadge}
                    errorCopyText={
                      status.kind === "error"
                        ? (status.copyText ?? status.message)
                        : undefined
                    }
                  />
                </div>
                {compareMode ? (
                  <div class="flex min-w-0 flex-col">
                    <StatusBar
                      kind={tableApiStatus.kind}
                      message={tableApiStatus.message}
                      messageTooltip={TABLE_API_STATUS_TIME_TOOLTIP}
                      badge={restCompareBadge}
                      errorCopyText={
                        tableApiStatus.kind === "error"
                          ? (tableApiStatus.copyText ?? tableApiStatus.message)
                          : undefined
                      }
                    />
                  </div>
                ) : null}
              </div>
              {hasStoredResults ? (
                <div class="flex justify-end">
                  <button
                    type="button"
                    class="btn px-2 py-0.5 text-[11px] text-muted"
                    onClick={handleClearStoredResults}
                    title="Remove every saved JDBC and Table API result grid from localStorage (all query tabs)"
                  >
                    Clear saved results
                  </button>
                </div>
              ) : null}
            </div>
            <div class="flex min-h-0 min-w-0 flex-[2] items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 px-4 text-center text-sm text-muted">
              Run a JDBC query, or enable compare and run the Table API, to see
              results here.
            </div>
          </>
        ) : (
          <>
            <div
              class={cn(
                "grid min-h-0 min-w-0 shrink-0 gap-3",
                compareMode ? "xl:grid-cols-2" : "grid-cols-1",
                editorUnderlayHidden && "pointer-events-none select-none",
              )}
              style={{ minHeight: `${editorSectionMinHeightPx}px` }}
              aria-hidden={editorUnderlayHidden ? true : undefined}
            >
              <Editor {...editorCommonProps} />
              {compareMode ? (
                <TableApiComparePanel
                  sqlText={activeTab.query}
                  form={tableApiForm}
                  connectionPayload={connectionPayload}
                  onFormChange={(next) =>
                    setTableApiFormByTab((prev) => ({
                      ...prev,
                      [activeId]: next,
                    }))
                  }
                  onRunRest={handleRunTableApi}
                  onStopRest={handleStop}
                  onRunBoth={handleRunBoth}
                  onTranslateNotice={handleTableApiTranslateNotice}
                  onApplyApproximateSqlToJdbc={onActiveQueryChange}
                  restRunning={tableApiBusy}
                  jdbcRunning={status.kind === "running"}
                  disableRestRun={false}
                />
              ) : null}
            </div>

            <div
              class={cn(
                "flex min-h-0 w-full flex-col gap-2 shrink-0",
                editorUnderlayHidden && "pointer-events-none",
              )}
              aria-hidden={editorUnderlayHidden ? true : undefined}
            >
              <div
                class={cn(
                  "grid min-w-0 w-full gap-3",
                  compareMode ? "xl:grid-cols-2" : "grid-cols-1",
                )}
              >
                <div class="flex min-w-0 flex-col">
                  <StatusBar
                    kind={status.kind}
                    message={status.message}
                    messageTooltip={JDBC_STATUS_TIME_TOOLTIP}
                    badge={jdbcCompareBadge}
                    errorCopyText={
                      status.kind === "error"
                        ? (status.copyText ?? status.message)
                        : undefined
                    }
                  />
                </div>
                {compareMode ? (
                  <div class="flex min-w-0 flex-col">
                    <StatusBar
                      kind={tableApiStatus.kind}
                      message={tableApiStatus.message}
                      messageTooltip={TABLE_API_STATUS_TIME_TOOLTIP}
                      badge={restCompareBadge}
                      errorCopyText={
                        tableApiStatus.kind === "error"
                          ? (tableApiStatus.copyText ?? tableApiStatus.message)
                          : undefined
                      }
                    />
                  </div>
                ) : null}
              </div>
              {hasStoredResults ? (
                <div class="flex justify-end">
                  <button
                    type="button"
                    class="btn px-2 py-0.5 text-[11px] text-muted"
                    onClick={handleClearStoredResults}
                    title="Remove every saved JDBC and Table API result grid from localStorage (all query tabs)"
                  >
                    Clear saved results
                  </button>
                </div>
              ) : null}
            </div>

            {showExpandedOverlay ? (
              <div
                class="pointer-events-auto absolute left-1/2 top-0 z-50 flex h-full min-h-0 w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface shadow-2xl ring-1 ring-border sm:w-[calc(100vw-4rem)]"
              >
                <div class="min-h-0 flex-1">
                  <ResultsTable
                    result={result!}
                    resultsExpanded={resultsExpanded}
                    onToggleResultsExpanded={handleToggleResultsExpanded}
                    maxVisibleDataRows={null}
                  />
                </div>
              </div>
            ) : compareMode && result && tableApiResult ? (
              <div class="grid min-h-0 min-w-0 flex-1 items-start gap-3 xl:grid-cols-2">
                <div class="min-h-0 w-full min-w-0">
                  {renderJdbcResultPane(result, {
                    browserMs: activeTab.lastRunDurationMs,
                  })}
                </div>
                <div class="min-h-0 w-full min-w-0">
                  {renderTableApiResultPane(
                    tableApiResult,
                    activeTab.lastTableApiBrowserMs,
                  )}
                </div>
              </div>
            ) : compareMode && result && tableApiBusy && !tableApiResult ? (
              <div class="grid min-h-0 min-w-0 flex-1 items-start gap-3 xl:grid-cols-2">
                <div class="min-h-0 w-full min-w-0">
                  {renderJdbcResultPane(result, {
                    browserMs: activeTab.lastRunDurationMs,
                  })}
                </div>
                <div class="flex min-h-[12rem] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 px-4 py-8 text-center">
                  <p class="font-mono text-sm text-muted">Table API running…</p>
                  <p class="mt-2 font-mono text-[11px] text-subtle">
                    {tableApiStatus.message}
                  </p>
                </div>
              </div>
            ) : result ? (
              <div
                class={cn(
                  "flex min-h-0 min-w-0 flex-col",
                  resultsExpanded ? "relative flex-1" : "relative flex-1 min-h-0",
                )}
              >
                {renderJdbcResultPane(result, {
                  resultsExpanded,
                  onToggleResultsExpanded: handleToggleResultsExpanded,
                  browserMs: activeTab.lastRunDurationMs,
                })}
              </div>
            ) : compareMode && tableApiBusy && !tableApiResult ? (
              <div class="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 px-4 py-8 text-center">
                <p class="font-mono text-sm text-muted">
                  Table API running…
                </p>
                <p class="mt-2 font-mono text-[11px] text-subtle">
                  {tableApiStatus.message}
                </p>
                <p class="mt-1 font-mono text-[11px] text-subtle">
                  Use Stop in the query toolbar if this takes too long.
                </p>
              </div>
            ) : compareMode && tableApiResult ? (
              <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                {renderTableApiResultPane(
                  tableApiResult,
                  activeTab.lastTableApiBrowserMs,
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
};
