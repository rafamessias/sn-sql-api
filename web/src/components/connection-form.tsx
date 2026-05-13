import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  URL_INSTANCE_PLACEHOLDER,
  deriveConnectionName,
  type ConnectionFormState,
  type SavedConnection,
  emptyConnection,
} from "../lib/connections";

type ConnectionFormProps = {
  editing: SavedConnection | null;
  onSubmit: (form: ConnectionFormState) => void;
  onCancel: () => void;
};

export const ConnectionForm = ({
  editing,
  onSubmit,
  onCancel,
}: ConnectionFormProps) => {
  const [form, setForm] = useState<ConnectionFormState>(() =>
    editing ? { ...editing } : emptyConnection(),
  );
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const placeholderConsumedRef = useRef<boolean>(false);

  useEffect(() => {
    setForm(editing ? { ...editing } : emptyConnection());
    setError(null);
    placeholderConsumedRef.current = false;
  }, [editing]);

  const handleUrlFocus: JSX.FocusEventHandler<HTMLInputElement> = (event) => {
    if (placeholderConsumedRef.current) return;
    const input = event.target as HTMLInputElement;
    const start = input.value.indexOf(URL_INSTANCE_PLACEHOLDER);
    if (start === -1) return;
    placeholderConsumedRef.current = true;
    requestAnimationFrame(() => {
      input.setSelectionRange(start, start + URL_INSTANCE_PLACEHOLDER.length);
    });
  };

  const update = <K extends keyof ConnectionFormState>(
    key: K,
    value: ConnectionFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit: JSX.GenericEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!form.url.trim()) {
      setError("JDBC URL is required.");
      return;
    }
    if (form.url.includes(URL_INSTANCE_PLACEHOLDER)) {
      setError(
        `Replace "${URL_INSTANCE_PLACEHOLDER}" in the JDBC URL with your real instance name.`,
      );
      urlInputRef.current?.focus();
      return;
    }
    const instanceName = deriveConnectionName(form.url);
    if (!instanceName) {
      setError(
        "Could not read a ServiceNow instance from the JDBC URL. Check the URL format.",
      );
      urlInputRef.current?.focus();
      return;
    }
    if (!form.user.trim()) {
      setError("Username is required.");
      return;
    }
    setError(null);
    onSubmit({
      name: instanceName,
      url: form.url.trim(),
      user: form.user.trim(),
      password: form.password,
      driverClass: form.driverClass.trim(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      class="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <header class="flex items-center justify-between">
        <h2 class="font-mono text-[12px] text-accent">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        {editing && (
          <span class="badge">
            <span class="text-subtle">id</span>
            <span class="text-text">{editing.id.slice(0, 8)}</span>
          </span>
        )}
      </header>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
            driver class (optional)
          </span>
          <input
            class="input"
            type="text"
            placeholder="com.snc.db.jdbc.JDBCDriver"
            value={form.driverClass}
            onInput={(e) =>
              update("driverClass", (e.target as HTMLInputElement).value)
            }
          />
        </label>

        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-subtle">
            <span>jdbc url</span>
            <span class="normal-case text-subtle/80">
              replace{" "}
              <code class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-warn">
                {URL_INSTANCE_PLACEHOLDER}
              </code>{" "}
              with your subdomain
            </span>
          </span>
          <input
            ref={urlInputRef}
            class="input"
            type="text"
            placeholder="jdbc:servicenow://https://mycompany.service-now.com"
            value={form.url}
            onInput={(e) => update("url", (e.target as HTMLInputElement).value)}
            onFocus={handleUrlFocus}
            required
            spellcheck={false}
            autocapitalize="off"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
            username
          </span>
          <input
            class="input"
            type="text"
            autocomplete="username"
            value={form.user}
            onInput={(e) => update("user", (e.target as HTMLInputElement).value)}
            required
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="font-mono text-[11px] uppercase tracking-wider text-subtle">
            password
          </span>
          <div class="relative">
            <input
              class="input pr-12"
              type={showPassword ? "text" : "password"}
              autocomplete="new-password"
              value={form.password}
              onInput={(e) =>
                update("password", (e.target as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              class="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-1 font-mono text-[10px] text-subtle hover:text-text"
            >
              {showPassword ? "HIDE" : "SHOW"}
            </button>
          </div>
        </label>
      </div>

      {error && (
        <p class="font-mono text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}

      <div class="flex items-center justify-end gap-2">
        <button type="button" class="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary">
          {editing ? "Save changes" : "Add connection"}
        </button>
      </div>
    </form>
  );
};
