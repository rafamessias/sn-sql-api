import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { checkConnection } from "../lib/api";
import { cn } from "../lib/cn";
import { EASTER_EGG_EVENT } from "./easter-egg";
import {
  SERVER_DEFAULT_ID,
  connectionInstanceLabel,
  toPayload,
  type ConnectionPayload,
  type SavedConnection,
} from "../lib/connections";

type Status =
  | { kind: "checking" }
  | { kind: "ok"; instance: string | null }
  | { kind: "error"; message: string };

type HeaderProps = {
  connections: SavedConnection[];
  activeId: string;
  onActiveIdChange: (next: string) => void;
};

const REFRESH_INTERVAL_MS = 30_000;
const EASTER_EGG_CLICK_TARGET = 5;
const EASTER_EGG_CLICK_WINDOW_MS = 2_500;

export const Header = ({
  connections,
  activeId,
  onActiveIdChange,
}: HeaderProps) => {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  const active = useMemo(
    () => connections.find((entry) => entry.id === activeId) ?? null,
    [connections, activeId],
  );

  const isServerDefault = activeId === SERVER_DEFAULT_ID || active === null;

  const connectionPayload: ConnectionPayload | undefined = useMemo(
    () => (active ? toPayload(active) : undefined),
    [active],
  );

  // What we *want* to show in the badge label — derived from the URL when
  // a custom connection is active; from the probe response otherwise.
  const localInstance = useMemo(
    () => (active ? connectionInstanceLabel(active) : null),
    [active],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const probe = async () => {
      setStatus({ kind: "checking" });
      try {
        const result = await checkConnection(
          connectionPayload,
          null,
          controller.signal,
        );
        if (cancelled) return;
        if (result.status === "ok") {
          setStatus({
            kind: "ok",
            instance: localInstance ?? result.instance,
          });
        } else {
          setStatus({
            kind: "error",
            message: result.error ?? "connection failed",
          });
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "unreachable",
        });
      }
    };

    void probe();
    const id = window.setInterval(probe, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
    // Trigger a fresh probe whenever the active connection changes.
  }, [
    connectionPayload?.url,
    connectionPayload?.user,
    connectionPayload?.password,
    connectionPayload?.driver_class,
    localInstance,
  ]);

  const handleSelect: JSX.GenericEventHandler<HTMLSelectElement> = (event) => {
    onActiveIdChange((event.target as HTMLSelectElement).value);
  };

  const easterEggClicksRef = useRef<number[]>([]);

  const handleLogoClick = useCallback(() => {
    const now = Date.now();
    const recent = easterEggClicksRef.current.filter(
      (timestamp) => now - timestamp < EASTER_EGG_CLICK_WINDOW_MS,
    );
    recent.push(now);
    easterEggClicksRef.current = recent;

    if (recent.length >= EASTER_EGG_CLICK_TARGET) {
      easterEggClicksRef.current = [];
      window.dispatchEvent(new CustomEvent(EASTER_EGG_EVENT));
    }
  }, []);

  const badgeClass = cn("badge", {
    "badge-ok": status.kind === "ok",
    "badge-err": status.kind === "error",
  });

  const dotClass = cn("h-2 w-2 rounded-full", {
    "bg-subtle animate-pulse": status.kind === "checking",
    "bg-accent": status.kind === "ok",
    "bg-danger": status.kind === "error",
  });

  const label = (() => {
    if (status.kind === "checking") return "checking…";
    if (status.kind === "ok") {
      return status.instance ?? (isServerDefault ? ".env" : "connected");
    }
    return "not connected";
  })();

  const title = status.kind === "error" ? status.message : undefined;

  return (
    <header class="sticky top-0 z-20 border-b border-border bg-bg">
      <div class="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-4 px-6 py-3">
        <div class="flex items-center gap-3">
          <button
            type="button"
            onClick={handleLogoClick}
            aria-label="sn-sql-api logo"
            title="sn-sql-api"
            class="grid h-8 w-8 place-items-center rounded-md border border-accent bg-accent-dim text-sm text-text transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true">⌘</span>
          </button>
          <div class="flex flex-col leading-tight">
            <span class="font-mono text-xs text-accent">sn-sql-api</span>
            <span class="text-[11px] text-muted">ServiceNow SQL API Console</span>
          </div>
        </div>

        <div class="hidden h-6 w-px bg-border sm:block" />

        <div class="flex items-center gap-2">
          <label
            for="active-connection"
            class="font-mono text-[11px] uppercase tracking-wider text-subtle"
          >
            connection
          </label>
          <select
            id="active-connection"
            value={activeId}
            onChange={handleSelect}
            class="input w-56 cursor-pointer pr-8"
          >
            <option value={SERVER_DEFAULT_ID}>.env</option>
            {connections.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {connectionInstanceLabel(entry)}
              </option>
            ))}
          </select>
        </div>

        <div class="flex flex-1 flex-wrap items-center gap-2 text-xs text-muted">
          <span class={badgeClass} title={title}>
            <span class={dotClass} />
            <span>{label}</span>
          </span>
        </div>
      </div>
    </header>
  );
};
