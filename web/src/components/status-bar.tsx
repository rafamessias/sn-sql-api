import { useCallback, useEffect, useState } from "preact/hooks";
import { cn } from "../lib/cn";

type StatusKind = "idle" | "running" | "ok" | "error";

type StatusBarProps = {
  kind: StatusKind;
  message: string;
  /** Plain error text for the clipboard (no timing prefix). Only used when kind is error. */
  errorCopyText?: string;
};

export const StatusBar = ({ kind, message, errorCopyText }: StatusBarProps) => {
  const [copyLabel, setCopyLabel] = useState<"idle" | "ok" | "err">("idle");

  useEffect(() => {
    setCopyLabel("idle");
  }, [message, kind, errorCopyText]);

  const handleCopyError = useCallback(async () => {
    if (!errorCopyText) return;
    try {
      await navigator.clipboard.writeText(errorCopyText);
      setCopyLabel("ok");
      globalThis.setTimeout(() => setCopyLabel("idle"), 2000);
    } catch {
      setCopyLabel("err");
      globalThis.setTimeout(() => setCopyLabel("idle"), 2500);
    }
  }, [errorCopyText]);

  const dotClass = cn("h-2 w-2 shrink-0 rounded-full", {
    "bg-subtle": kind === "idle",
    "bg-warn animate-pulse": kind === "running",
    "bg-accent": kind === "ok",
    "bg-danger": kind === "error",
  });

  const textClass = cn("min-w-0 truncate font-mono text-[12px]", {
    "text-muted": kind === "idle" || kind === "running",
    "text-accent": kind === "ok",
    "text-danger": kind === "error",
  });

  const showCopyError =
    kind === "error" &&
    errorCopyText !== undefined &&
    errorCopyText.length > 0;

  const copyButtonLabel =
    copyLabel === "ok"
      ? "Copied"
      : copyLabel === "err"
        ? "Copy failed"
        : "Copy error";

  return (
    <div class="grid min-w-0 w-full max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 overflow-hidden px-1">
      <span class={dotClass} aria-hidden="true" />
      <span class={textClass} title={message}>
        {message}
      </span>
      {showCopyError ? (
        <button
          type="button"
          class="btn shrink-0 justify-self-end px-2 py-0.5 text-[11px] whitespace-nowrap"
          onClick={handleCopyError}
          title="Copy only the error message (not the duration)"
        >
          {copyButtonLabel}
        </button>
      ) : null}
    </div>
  );
};
