/** Combine abort signals; aborts when any source aborts. */
export const mergeAbortSignals = (
  ...signals: readonly AbortSignal[]
): AbortSignal => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
};

/** Abort after `ms` (composes with an optional parent signal). */
export const abortSignalAfterMs = (
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } => {
  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => timeoutController.abort(), ms);
  const dispose = () => globalThis.clearTimeout(timeoutId);
  const signal = parent
    ? mergeAbortSignals(parent, timeoutController.signal)
    : timeoutController.signal;
  return { signal, dispose };
};
