import { SqlCodeEditor } from "./sql-code-editor";

type EditorProps = {
  query: string;
  onQueryChange: (next: string) => void;
  isRunning: boolean;
  canExport: boolean;
  onRun: () => void;
  onClear: () => void;
  onCopyCsv: () => void;
  schemaTables?: readonly string[];
};

export const Editor = ({
  query,
  onQueryChange,
  isRunning,
  canExport,
  onRun,
  onClear,
  onCopyCsv,
  schemaTables,
}: EditorProps) => {
  return (
    <section class="flex min-w-0 flex-col gap-3">
      <div class="min-w-0 max-w-full overflow-hidden rounded-lg border border-border">
        <div class="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
          <div class="flex items-center gap-2 font-mono text-[11px] text-subtle">
            <span class="h-2 w-2 rounded-full bg-accent" />
            <span class="text-accent">query.sql</span>
            <span class="text-subtle">— ad-hoc</span>
          </div>
          <div class="flex items-center gap-3 font-mono text-[11px] text-subtle">
            <span title="Ctrl/Cmd+Space for suggestions">{query.length} chars</span>
          </div>
        </div>
        <SqlCodeEditor
          value={query}
          onChange={onQueryChange}
          onRun={onRun}
          schemaTables={schemaTables}
        />
        <div class="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-2">
          <button
            type="button"
            class="btn btn-primary"
            onClick={onRun}
            disabled={isRunning || query.trim().length === 0}
          >
            {isRunning ? "Running…" : "Run query"}
          </button>
          <button
            type="button"
            class="btn"
            onClick={onClear}
            disabled={isRunning}
          >
            Clear
          </button>
          <button
            type="button"
            class="btn"
            onClick={onCopyCsv}
            disabled={!canExport}
            title="Copy results as CSV"
          >
            Copy CSV
          </button>
          <span class="ml-auto hidden font-mono text-[10px] text-subtle sm:inline">
            Ctrl+Space · keywords + tables
          </span>
        </div>
      </div>
    </section>
  );
};
