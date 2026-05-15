import { useMemo, useState } from "preact/hooks";
import type { ConnectionPayload } from "../lib/connections";
import { cn } from "../lib/cn";
import {
  analyzeTableApiLimits,
  TABLE_API_DOCS_URL,
  TABLE_API_LIMIT_REFERENCE,
  TABLE_API_PAGINATION_ERROR_URL,
  tableApiLimitRemedies,
  type TableApiLimitIssue,
} from "../lib/table-api-limits";
import type { TableApiFormState } from "../lib/table-api-form";

type TableApiLimitsAdviceProps = {
  form: TableApiFormState;
  connectionPayload: ConnectionPayload | undefined;
};

const severityStyles: Record<
  TableApiLimitIssue["severity"],
  { box: string; title: string }
> = {
  error: {
    box: "border-danger/50 bg-danger/10 text-danger",
    title: "text-danger",
  },
  warn: {
    box: "border-warn/50 bg-warn/10 text-warn",
    title: "text-warn",
  },
  info: {
    box: "border-info/40 bg-info/5 text-muted",
    title: "text-info",
  },
};

const WarningTriangleIcon = () => (
  <svg
    aria-hidden="true"
    class="h-3 w-3 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

type LimitsDialogProps = {
  form: TableApiFormState;
  connectionPayload: ConnectionPayload | undefined;
  onClose: () => void;
};

const LimitsDialog = ({
  form,
  connectionPayload,
  onClose,
}: LimitsDialogProps) => {
  const issues = useMemo(
    () => analyzeTableApiLimits(form, connectionPayload),
    [form, connectionPayload],
  );
  const remedies = useMemo(() => tableApiLimitRemedies(form), [form]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn");
  const alertIssues = issues.filter(
    (i) => i.severity === "error" || i.severity === "warn",
  );
  const infoIssues = issues.filter((i) => i.severity === "info");
  const hasAlerts = alertIssues.length > 0;
  const isError = errors.length > 0;

  const dialogTitle = hasAlerts
    ? isError
      ? "Table API configuration issues"
      : "Table API configuration warnings"
    : "Table API limits & tips";

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-api-limits-title"
        class="flex max-h-[min(90vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      >
        <div class="shrink-0 border-b border-border px-4 py-3">
          <h2
            id="table-api-limits-title"
            class="font-mono text-sm font-medium text-text"
          >
            {dialogTitle}
          </h2>
          <p class="mt-1 font-mono text-[11px] text-subtle">
            Heuristic checks in this UI — your instance may enforce stricter
            rules. JDBC in the left panel is not subject to the same REST URL
            limits.
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {hasAlerts ? (
            <section class="mb-4">
              <h3 class="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">
                {isError
                  ? `${errors.length} issue(s), ${warnings.length} warning(s)`
                  : `${warnings.length} warning(s)`}
              </h3>
              <ul class="mt-2 space-y-2">
                {alertIssues.map((issue) => (
                  <li
                    key={issue.id}
                    class={cn(
                      "rounded border px-2.5 py-2 font-mono text-[11px]",
                      severityStyles[issue.severity].box,
                    )}
                  >
                    <p
                      class={cn(
                        "font-medium",
                        severityStyles[issue.severity].title,
                      )}
                    >
                      {issue.title}
                    </p>
                    <p class="mt-0.5 text-text/90">{issue.body}</p>
                  </li>
                ))}
              </ul>
              {remedies.length > 0 ? (
                <p class="mt-2 font-mono text-[11px] text-muted">
                  <span class="text-text">Suggested fixes:</span>{" "}
                  {remedies.join(" · ")}
                </p>
              ) : null}
            </section>
          ) : infoIssues.length > 0 ? (
            <section class="mb-4">
              <h3 class="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">
                Notes
              </h3>
              <ul class="mt-2 space-y-2">
                {infoIssues.map((issue) => (
                  <li
                    key={issue.id}
                    class={cn(
                      "rounded border px-2.5 py-2 font-mono text-[11px]",
                      severityStyles[issue.severity].box,
                    )}
                  >
                    <p
                      class={cn(
                        "font-medium",
                        severityStyles[issue.severity].title,
                      )}
                    >
                      {issue.title}
                    </p>
                    <p class="mt-0.5 text-text/90">{issue.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p class="mb-4 font-mono text-[11px] text-muted">
              No issues detected for the current fields. Limits still apply on
              the instance as you add query text or columns.
            </p>
          )}

          <section>
            <h3 class="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">
              Reference
            </h3>
            <div class="mt-2 overflow-x-auto rounded border border-border">
              <table class="w-full min-w-[280px] border-collapse font-mono text-[10px]">
                <thead>
                  <tr class="border-b border-border bg-surface-2 text-left text-subtle">
                    <th class="px-2 py-1.5 font-medium">Topic</th>
                    <th class="px-2 py-1.5 font-medium">Typical limit</th>
                    <th class="px-2 py-1.5 font-medium">Why it matters</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_API_LIMIT_REFERENCE.map((row) => (
                    <tr
                      key={row.topic}
                      class="border-b border-border/60 align-top text-muted last:border-0"
                    >
                      <td class="px-2 py-1.5 text-text">{row.topic}</td>
                      <td class="px-2 py-1.5">{row.limit}</td>
                      <td class="px-2 py-1.5">{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ul class="mt-4 space-y-1 font-mono text-[11px]">
            <li>
              <a
                href={TABLE_API_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent underline-offset-2 hover:underline"
              >
                ServiceNow Table API reference
              </a>
            </li>
            <li>
              <a
                href={TABLE_API_PAGINATION_ERROR_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent underline-offset-2 hover:underline"
              >
                Community: “Pagination not supported” (HTTP 400)
              </a>
            </li>
          </ul>
        </div>

        <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" class="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const TableApiLimitsAdvice = ({
  form,
  connectionPayload,
}: TableApiLimitsAdviceProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const issues = useMemo(
    () => analyzeTableApiLimits(form, connectionPayload),
    [form, connectionPayload],
  );
  const alertCount = issues.filter(
    (i) => i.severity === "error" || i.severity === "warn",
  ).length;
  const isError = issues.some((i) => i.severity === "error");

  if (alertCount === 0) return null;

  return (
    <>
      <button
        type="button"
        class={cn(
          "btn relative shrink-0 gap-0 px-2 py-1 text-[11px]",
          isError
            ? "border-danger/50 text-danger hover:border-danger hover:bg-danger/10 hover:text-danger"
            : "border-warn/50 text-warn hover:border-warn hover:bg-warn/10 hover:text-warn",
        )}
        onClick={() => setDialogOpen(true)}
        aria-label={`${alertCount} Table API configuration warning${alertCount === 1 ? "" : "s"}`}
        title={`${alertCount} warning${alertCount === 1 ? "" : "s"} — click for details`}
      >
        <WarningTriangleIcon />
        <span
          class={cn(
            "absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[8px] font-medium leading-none",
            isError ? "bg-danger text-surface" : "bg-warn text-surface",
          )}
        >
          {alertCount > 9 ? "9+" : alertCount}
        </span>
      </button>

      {dialogOpen ? (
        <LimitsDialog
          form={form}
          connectionPayload={connectionPayload}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
};

export const TableApiLimitsReferenceLink = ({
  form,
  connectionPayload,
}: TableApiLimitsAdviceProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        class="text-[10px] text-accent underline-offset-2 hover:underline"
        onClick={() => setDialogOpen(true)}
      >
        Limits &amp; reference
      </button>
      {dialogOpen ? (
        <LimitsDialog
          form={form}
          connectionPayload={connectionPayload}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
};
