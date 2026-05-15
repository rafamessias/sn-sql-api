import { useEffect, useState } from "preact/hooks";
import { cn } from "../lib/cn";
import { TOAST_EVENT, type ToastVariant } from "../lib/toast";

type ToastItem = { id: string; message: string; variant: ToastVariant };

const TOAST_MS = 4200;

export const ToastHost = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string; variant?: ToastVariant }>;
      const message = ce.detail?.message?.trim();
      if (!message) return;
      const variant = ce.detail.variant ?? "ok";
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setItems((prev) => [...prev, { id, message, variant }]);
      globalThis.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_MS);
    };
    window.addEventListener(TOAST_EVENT, handler as EventListener);
    return () => window.removeEventListener(TOAST_EVENT, handler as EventListener);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((t) => (
        <div
          key={t.id}
          class={cn(
            "pointer-events-none rounded-md border px-3 py-2 font-mono text-[12px] leading-snug shadow-lg ring-1 ring-black/20",
            t.variant === "error"
              ? "border-danger/60 bg-surface text-danger"
              : "border-border bg-surface text-text",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
};
