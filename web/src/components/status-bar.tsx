import { cn } from "../lib/cn";

type StatusKind = "idle" | "running" | "ok" | "error";

type StatusBarProps = {
  kind: StatusKind;
  message: string;
};

export const StatusBar = ({ kind, message }: StatusBarProps) => {
  const dotClass = cn("h-2 w-2 rounded-full", {
    "bg-subtle": kind === "idle",
    "bg-warn animate-pulse": kind === "running",
    "bg-accent": kind === "ok",
    "bg-danger": kind === "error",
  });

  const textClass = cn("font-mono text-[12px]", {
    "text-muted": kind === "idle" || kind === "running",
    "text-accent": kind === "ok",
    "text-danger": kind === "error",
  });

  return (
    <div class="flex items-center gap-2 px-1">
      <span class={dotClass} aria-hidden="true" />
      <span class={textClass}>{message}</span>
    </div>
  );
};
