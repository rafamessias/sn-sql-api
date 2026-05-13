import { useCallback, useEffect, useState } from "preact/hooks";
import { fetchAbout, type AboutInfo } from "../lib/api";

export const EASTER_EGG_EVENT = "snsql:easter-egg";

const KONAMI: readonly string[] = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export const EasterEgg = () => {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    let buffer: string[] = [];
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
      buffer = [...buffer, key].slice(-KONAMI.length);
      if (buffer.length === KONAMI.length && buffer.every((k, i) => k === KONAMI[i])) {
        buffer = [];
        handleOpen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpen]);

  useEffect(() => {
    const handler = () => handleOpen();
    window.addEventListener(EASTER_EGG_EVENT, handler);
    return () => window.removeEventListener(EASTER_EGG_EVENT, handler);
  }, [handleOpen]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, handleClose]);

  useEffect(() => {
    if (!open || about || loading) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAbout(controller.signal)
      .then((info) => setAbout(info))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not reach /about");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, about, loading]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="easter-egg-title"
      class="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur"
      onClick={handleClose}
    >
      <div
        class="relative w-full max-w-lg overflow-hidden rounded-xl border border-accent bg-surface shadow-focus"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="border-b border-border bg-accent-dim/40 px-6 py-4">
          <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            // easter egg unlocked
          </p>
          <h2 id="easter-egg-title" class="mt-1 font-mono text-lg text-text">
            sn-sql-api — credits
          </h2>
        </div>

        <div class="space-y-4 px-6 py-5 font-mono text-xs leading-relaxed text-muted">
          {loading && <p class="text-subtle">fetching credits…</p>}

          {error && (
            <p class="text-danger">
              /about failed: <span class="text-muted">{error}</span>
            </p>
          )}

          {about && (
            <>
              <p class="text-text">{about.tagline}</p>

              <dl class="space-y-2">
                <div class="flex gap-3">
                  <dt class="w-20 text-subtle">author</dt>
                  <dd class="text-text">
                    {about.linkedin ? (
                      <a
                        href={about.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {about.author}
                      </a>
                    ) : (
                      about.author
                    )}
                  </dd>
                </div>

                <div class="flex gap-3">
                  <dt class="w-20 text-subtle">license</dt>
                  <dd class="text-text">{about.license}</dd>
                </div>

                {about.repository && (
                  <div class="flex gap-3">
                    <dt class="w-20 text-subtle">source</dt>
                    <dd class="truncate">
                      <a
                        href={about.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {about.repository}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              <p class="border-t border-border pt-3 text-subtle">
                {about.license_summary}
              </p>

              <div class="rounded border border-l-[3px] border-warn bg-warn/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warn">
                <p class="mb-1 font-mono text-[9px] uppercase tracking-[0.2em]">
                  Disclaimer
                </p>
                <p>{about.disclaimer}</p>
              </div>

              <details class="group ml-auto flex max-w-full flex-row-reverse flex-wrap items-center justify-end gap-2.5">
                <summary
                  class="flex h-8 w-8 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg border border-transparent text-[15px] leading-none opacity-[0.28] transition-[opacity,background-color,border-color] hover:border-border hover:bg-bg/60 hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden group-open:border-accent group-open:bg-accent-dim/30 group-open:opacity-100"
                  aria-label="Reveal a tiny secret"
                  title="Nothing to see here…"
                >
                  🔥
                </summary>
                <p class="min-w-0 flex-1 rounded border border-border bg-bg/60 px-2.5 py-1.5 text-right font-mono text-[11px] leading-snug text-accent">
                  {about.banner}
                </p>
              </details>
            </>
          )}
        </div>

        <div class="flex items-center justify-between border-t border-border bg-bg/40 px-6 py-3 font-mono text-[10px] text-subtle">
          <span>
            press{" "}
            <kbd class="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
              Esc
            </kbd>{" "}
            to close
          </span>
          <button type="button" class="btn" onClick={handleClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
};
