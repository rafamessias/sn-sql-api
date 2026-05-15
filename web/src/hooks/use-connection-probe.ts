import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { checkConnection } from "../lib/api";
import { abortSignalAfterMs } from "../lib/abort-signal";
import { appendAppLog } from "../lib/app-logs";
import type { ConnectionPayload } from "../lib/connections";

export type ConnectionProbeStatus =
  | { kind: "checking" }
  | { kind: "ok"; instance: string | null }
  | { kind: "error"; message: string };

type ProbeReason = "initial" | "interval" | "manual";

const REFRESH_INTERVAL_MS = 30_000;
/** Match backend JDBC health timeout; avoid hung fetches stacking on the dev proxy. */
const PROBE_TIMEOUT_MS = 25_000;

const buildDepsKey = (payload: ConnectionPayload | undefined): string => {
  if (!payload) return "__default__";
  return [
    payload.url,
    payload.user,
    payload.password,
    payload.driver_class ?? "",
  ].join("\0");
};

const logProbe = (
  reason: ProbeReason,
  ok: boolean,
  label: string,
  elapsedMs: string,
  detail: string | undefined,
  lastSigRef: { current: string },
): void => {
  const sig = ok ? `ok:${label}` : `err:${detail ?? ""}`;
  if (reason !== "manual" && sig === lastSigRef.current) return;
  lastSigRef.current = sig;

  if (ok) {
    appendAppLog({
      level: "success",
      category: "Connection",
      message: `Health check OK · ${label} · ${elapsedMs}`,
    });
  } else {
    appendAppLog({
      level: "error",
      category: "Connection",
      message: `Health check failed · ${label} · ${elapsedMs}`,
      detail,
    });
  }
};

type UseConnectionProbeArgs = {
  connectionPayload: ConnectionPayload | undefined;
  /** Used in badge when probe returns ok; shown in logs */
  displayLabel: string;
  isServerDefault: boolean;
};

export const useConnectionProbe = ({
  connectionPayload,
  displayLabel,
  isServerDefault,
}: UseConnectionProbeArgs) => {
  const [status, setStatus] = useState<ConnectionProbeStatus>({
    kind: "checking",
  });

  const payloadRef = useRef(connectionPayload);
  payloadRef.current = connectionPayload;

  const displayLabelRef = useRef(displayLabel);
  displayLabelRef.current = displayLabel;

  const isServerDefaultRef = useRef(isServerDefault);
  isServerDefaultRef.current = isServerDefault;

  const probeEpochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastSigRef = useRef("");

  const depsKey = useMemo(
    () => buildDepsKey(connectionPayload),
    [connectionPayload],
  );

  const executeProbe = useCallback(async (reason: ProbeReason) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const epoch = ++probeEpochRef.current;

    const payload = payloadRef.current;
    const logLabel = isServerDefaultRef.current ? ".env" : displayLabelRef.current;
    const localInstance = isServerDefaultRef.current
      ? null
      : displayLabelRef.current;

    const showCheckingUi = reason === "initial" || reason === "manual";
    if (showCheckingUi) {
      setStatus({ kind: "checking" });
    }

    const { signal: timedSignal, dispose: disposeTimeout } = abortSignalAfterMs(
      PROBE_TIMEOUT_MS,
      controller.signal,
    );

    const t0 = performance.now();

    try {
      const result = await checkConnection(payload, null, timedSignal);
      if (controller.signal.aborted || epoch !== probeEpochRef.current) return;
      const elapsed = `${Math.round(performance.now() - t0)}ms`;
      if (result.status === "ok") {
        const instance = localInstance ?? result.instance;
        setStatus({ kind: "ok", instance });
        logProbe(reason, true, logLabel, elapsed, undefined, lastSigRef);
      } else {
        const message = result.error ?? "connection failed";
        setStatus({ kind: "error", message });
        logProbe(reason, false, logLabel, elapsed, message, lastSigRef);
      }
    } catch (err) {
      if (controller.signal.aborted || epoch !== probeEpochRef.current) return;
      const elapsed = `${Math.round(performance.now() - t0)}ms`;
      const message =
        timedSignal.aborted && !controller.signal.aborted
          ? `Health check timed out after ${PROBE_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : "unreachable";
      setStatus({ kind: "error", message });
      logProbe(reason, false, logLabel, elapsed, message, lastSigRef);
    } finally {
      disposeTimeout();
    }
  }, []);

  useEffect(() => {
    lastSigRef.current = "";
    const intervalId = window.setInterval(() => {
      void executeProbe("interval");
    }, REFRESH_INTERVAL_MS);
    void executeProbe("initial");
    return () => {
      window.clearInterval(intervalId);
      abortRef.current?.abort();
    };
  }, [depsKey, executeProbe]);

  const retryConnectionProbe = useCallback(() => {
    void executeProbe("manual");
  }, [executeProbe]);

  return { connectionStatus: status, retryConnectionProbe };
};
