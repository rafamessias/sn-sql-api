import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { ConnectionForm } from "./connection-form";
import {
  SERVER_DEFAULT_ID,
  buildExport,
  connectionInstanceLabel,
  parseImport,
  type ConnectionFormState,
  type SavedConnection,
} from "../lib/connections";
import { fetchEgressIp, type EgressIpInfo } from "../lib/api";
import { cn } from "../lib/cn";

type ConnectionsPanelProps = {
  connections: SavedConnection[];
  activeId: string;
  onSetActive: (id: string) => void;
  onCreate: (form: ConnectionFormState) => SavedConnection;
  onUpdate: (id: string, form: ConnectionFormState) => void;
  onRemove: (id: string) => void;
  onMergeImport: (incoming: SavedConnection[]) => void;
};

type Notice =
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string }
  | null;

type EgressState =
  | { status: "loading" }
  | { status: "ok"; ip: string }
  | { status: "error"; message: string };

const egressStateFromApi = (data: EgressIpInfo): EgressState => {
  if (data.ip) return { status: "ok", ip: data.ip };
  if (data.error) return { status: "error", message: data.error };
  return {
    status: "error",
    message: "No address returned from server.",
  };
};

const runEgressLookup = async (
  signal: AbortSignal,
  setEgress: (next: EgressState) => void,
): Promise<void> => {
  setEgress({ status: "loading" });
  try {
    const data = await fetchEgressIp(signal);
    if (signal.aborted) return;
    setEgress(egressStateFromApi(data));
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    setEgress({ status: "error", message });
  }
};

const downloadJson = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const ConnectionsPanel = ({
  connections,
  activeId,
  onSetActive,
  onCreate,
  onUpdate,
  onRemove,
  onMergeImport,
}: ConnectionsPanelProps) => {
  const [editing, setEditing] = useState<SavedConnection | null>(null);
  const [showForm, setShowForm] = useState<boolean>(connections.length === 0);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedConnection | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const [egress, setEgress] = useState<EgressState>({ status: "loading" });
  const [egressCopied, setEgressCopied] = useState<boolean>(false);

  useEffect(() => {
    const controller = new AbortController();
    void runEgressLookup(controller.signal, setEgress);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!egressCopied) return;
    const t = window.setTimeout(() => setEgressCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [egressCopied]);

  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  useLayoutEffect(() => {
    if (pendingDelete) deleteCancelRef.current?.focus();
  }, [pendingDelete]);

  const handleSubmit = (form: ConnectionFormState) => {
    if (editing) {
      onUpdate(editing.id, form);
      setNotice({ kind: "ok", message: `Updated ${form.name}.` });
    } else {
      const created = onCreate(form);
      setNotice({ kind: "ok", message: `Added ${created.name}.` });
    }
    setEditing(null);
    setShowForm(false);
  };

  const handleExport = () => {
    if (connections.length === 0) {
      setNotice({ kind: "error", message: "Nothing to export." });
      return;
    }
    const payload = buildExport(connections);
    const filename = `sn-sql-connections-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    downloadJson(filename, JSON.stringify(payload, null, 2));
    setNotice({
      kind: "ok",
      message: `Exported ${connections.length} connection(s).`,
    });
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile: JSX.GenericEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = parseImport(text);
      if (incoming.length === 0) {
        setNotice({
          kind: "error",
          message: "No valid connections found in file.",
        });
        return;
      }
      onMergeImport(incoming);
      setNotice({
        kind: "ok",
        message: `Imported ${incoming.length} connection(s) (merged by instance).`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice({ kind: "error", message: `Import failed: ${message}` });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          + New connection
        </button>
        <button type="button" class="btn" onClick={handleExport}>
          Export JSON
        </button>
        <button type="button" class="btn" onClick={handleImportClick}>
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          class="hidden"
          onChange={handleImportFile}
        />
        <span class="ml-auto font-mono text-[11px] text-subtle">
          stored in browser localStorage · not synced
        </span>
      </div>

      <div class="rounded-lg border border-border bg-surface-2 px-4 py-3 font-mono text-[12px] text-text">
        <div class="flex flex-wrap items-center gap-2 gap-y-1">
          <span class="text-subtle">Outbound IP (for instance allow list)</span>
          {egress.status === "loading" && (
            <span class="text-muted">looking up…</span>
          )}
          {egress.status === "ok" && (
            <>
              <code class="rounded border border-border bg-surface px-2 py-0.5 text-info">
                {egress.ip}
              </code>
              <button
                type="button"
                class="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(egress.ip);
                    setEgressCopied(true);
                  } catch {
                    setNotice({
                      kind: "error",
                      message: "Could not copy to clipboard.",
                    });
                  }
                }}
              >
                {egressCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => {
                  const controller = new AbortController();
                  void runEgressLookup(controller.signal, setEgress);
                }}
              >
                Refresh
              </button>
            </>
          )}
          {egress.status === "error" && (
            <>
              <span class="text-danger">{egress.message}</span>
              <button
                type="button"
                class="btn"
                onClick={() => {
                  const controller = new AbortController();
                  void runEgressLookup(controller.signal, setEgress);
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-muted">
          This is the public address this API server uses for outbound HTTPS
          from its deployment (same NAT as typical JDBC traffic). Add it to your
          ServiceNow instance network allow list if required—not your laptop
          browser address.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          class={cn(
            "rounded-md border px-3 py-2 font-mono text-[12px]",
            notice.kind === "ok"
              ? "border-accent/40 bg-accent-dim/40 text-accent"
              : "border-danger/40 bg-danger/10 text-danger",
          )}
        >
          {notice.message}
        </div>
      )}

      {showForm && (
        <ConnectionForm
          editing={editing}
          onSubmit={handleSubmit}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      <div class="rounded-lg border border-border bg-surface">
        <div class="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
          <span class="font-mono text-[11px] text-subtle">
            Saved connections
          </span>
          <span class="badge">
            <span class="text-text">{connections.length}</span>
          </span>
        </div>
        {connections.length === 0 ? (
          <p class="px-4 py-10 text-center font-mono text-[12px] text-muted">
            No connections yet. Add one above, or run with the server default
            from <code class="text-info">.env</code>.
          </p>
        ) : (
          <ul class="divide-y divide-border">
            {connections.map((entry) => {
              const label = connectionInstanceLabel(entry);
              const isActive = entry.id === activeId;
              return (
                <li
                  key={entry.id}
                  class={cn(
                    "flex flex-wrap items-center gap-3 px-4 py-3",
                    isActive && "bg-accent-dim/30",
                  )}
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate font-mono text-[13px] text-text">
                        {label}
                      </span>
                      {isActive && (
                        <span class="badge badge-ok">
                          <span class="h-2 w-2 rounded-full bg-accent" />
                          active
                        </span>
                      )}
                    </div>
                    <p class="truncate font-mono text-[11px] text-muted">
                      {entry.url}
                    </p>
                    <p class="font-mono text-[11px] text-subtle">
                      user: <span class="text-info">{entry.user}</span>
                      {entry.driverClass && (
                        <>
                          {" "}
                          · driver:{" "}
                          <span class="text-info">{entry.driverClass}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    {!isActive && (
                      <button
                        type="button"
                        class="btn"
                        onClick={() => onSetActive(entry.id)}
                      >
                        Set active
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn"
                      onClick={() => {
                        setEditing(entry);
                        setShowForm(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn"
                      onClick={() => setPendingDelete(entry)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div class="rounded-lg border border-warn/40 bg-warn/5 p-3 font-mono text-[11px] text-warn">
        Passwords are stored unencrypted in your browser&apos;s localStorage.
        Use only on machines you trust. The server default
        ({SERVER_DEFAULT_ID === activeId ? "active" : "available"}) keeps
        secrets in <code>.env</code> only.
      </div>

      {pendingDelete && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-connection-title"
            class="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg"
          >
            <h2
              id="delete-connection-title"
              class="font-mono text-sm font-medium text-text"
            >
              Delete connection?
            </h2>
            <p class="mt-2 font-mono text-[12px] text-muted">
              Remove{" "}
              <span class="text-text">
                {connectionInstanceLabel(pendingDelete)}
              </span>
              . This cannot be undone.
            </p>
            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <button
                ref={deleteCancelRef}
                type="button"
                class="btn"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                class={cn(
                  "btn border-danger/50 bg-danger/10 text-danger",
                  "hover:border-danger hover:bg-danger/20 hover:text-danger",
                  "focus-visible:ring-danger",
                )}
                onClick={() => {
                  const label = connectionInstanceLabel(pendingDelete);
                  onRemove(pendingDelete.id);
                  setPendingDelete(null);
                  setNotice({ kind: "ok", message: `Deleted ${label}.` });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
