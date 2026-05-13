import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { SqlCodeEditor } from "./sql-code-editor";

type EditorProps = {
  query: string;
  onQueryChange: (next: string) => void;
  isRunning: boolean;
  onRun: () => void;
  onClear: () => void;
  onCopySql: () => void;
  onDownloadSql: () => void;
  onDownloadTxt: () => void;
  schemaTables?: readonly string[];
};

function collectMatchRanges(
  view: EditorView,
  searchStr: string,
): { from: number; to: number }[] {
  if (!searchStr) return [];
  const q = new SearchQuery({
    search: searchStr,
    caseSensitive: false,
    literal: true,
    wholeWord: false,
  });
  if (!q.valid) return [];
  const out: { from: number; to: number }[] = [];
  const cursor = q.getCursor(view.state);
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    out.push({ from: step.value.from, to: step.value.to });
  }
  return out;
}

function activeMatchIndex(
  ranges: readonly { from: number; to: number }[],
  sel: { from: number; to: number },
): number {
  const exact = ranges.findIndex(
    (r) => r.from === sel.from && r.to === sel.to,
  );
  if (exact >= 0) return exact;
  const head = sel.from;
  for (let i = 0; i < ranges.length; i++) {
    if (head >= ranges[i].from && head < ranges[i].to) return i;
    if (ranges[i].from > head) return i;
  }
  return ranges.length > 0 ? 0 : -1;
}

export const Editor = ({
  query,
  onQueryChange,
  isRunning,
  onRun,
  onClear,
  onCopySql,
  onDownloadSql,
  onDownloadTxt,
  schemaTables,
}: EditorProps) => {
  const canShareQuery = query.trim().length > 0;
  const cmViewRef = useRef<EditorView | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectionTick, setSelectionTick] = useState(0);
  const bumpSelectionTick = () => setSelectionTick((n) => n + 1);

  const applySearchQuery = useCallback(() => {
    const view = cmViewRef.current;
    if (!view) return;
    const q = new SearchQuery({
      search: searchTerm,
      caseSensitive: false,
      literal: true,
      wholeWord: false,
    });
    view.dispatch({ effects: setSearchQuery.of(q) });
    if (!q.valid) {
      if (searchPanelOpen(view.state)) closeSearchPanel(view);
      return;
    }
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
  }, [searchTerm]);

  useEffect(() => {
    applySearchQuery();
  }, [applySearchQuery]);

  const matchInfo = useMemo(() => {
    const view = cmViewRef.current;
    if (!view || !searchTerm.trim()) {
      return { total: 0, current: 0, label: "" as string };
    }
    const ranges = collectMatchRanges(view, searchTerm);
    const total = ranges.length;
    if (total === 0) {
      return { total: 0, current: 0, label: "0 matches" };
    }
    const sel = view.state.selection.main;
    const idx = activeMatchIndex(ranges, sel);
    const current = idx >= 0 ? idx + 1 : 0;
    const label =
      current > 0 ? `${current} / ${total}` : `— / ${total}`;
    return { total, current, label };
  }, [searchTerm, query, selectionTick]);

  const handleFindNext = () => {
    const view = cmViewRef.current;
    if (!view) return;
    findNext(view);
  };

  const handleFindPrevious = () => {
    const view = cmViewRef.current;
    if (!view) return;
    findPrevious(view);
  };

  const handleSearchKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) handleFindPrevious();
      else handleFindNext();
    }
  };

  const handleSearchInput = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    setSearchTerm(v);
  };

  const hasFind = searchTerm.length > 0;
  const findNavDisabled = !hasFind || matchInfo.total === 0;

  return (
    <section class="flex min-w-0 flex-col gap-3">
      <div class="min-w-0 max-w-full overflow-hidden rounded-lg border border-border">
        <div class="flex flex-col gap-2 border-b border-border bg-surface-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-2 font-mono text-[11px] text-subtle">
            <span class="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span class="text-accent">query.sql</span>
            <span class="text-subtle">— ad-hoc</span>
          </div>
          <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:max-w-[72%]">
            <div class="flex min-w-0 max-w-full flex-1 flex-nowrap items-center gap-1.5 sm:flex-initial">
              <label class="sr-only" for="editor-find-input">
                Search for text contained in query
              </label>
              <input
                id="editor-find-input"
                type="search"
                class="input min-w-0 max-w-[min(100%,14rem)] flex-1 py-1 font-mono text-[11px] sm:max-w-[14rem]"
                placeholder="Contains…"
                value={searchTerm}
                onInput={handleSearchInput}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                spellcheck={false}
                disabled={isRunning}
                title="Case-insensitive · Enter: next · Shift+Enter: previous"
              />
              <div class="inline-flex shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  class="btn rounded-none border-0 px-2.5 py-1 font-mono text-[13px] leading-none shadow-none ring-0"
                  title="Previous match (Shift+Enter)"
                  aria-label="Previous match"
                  onClick={handleFindPrevious}
                  disabled={isRunning || findNavDisabled}
                >
                  ←
                </button>
                <button
                  type="button"
                  class="btn rounded-none border-0 px-2.5 py-1 font-mono text-[13px] leading-none shadow-none ring-0"
                  title="Next match (Enter)"
                  aria-label="Next match"
                  onClick={handleFindNext}
                  disabled={isRunning || findNavDisabled}
                >
                  →
                </button>
              </div>
              <span
                class="shrink-0 font-mono text-[11px] tabular-nums text-subtle"
                aria-live="polite"
              >
                {hasFind ? matchInfo.label : ""}
              </span>
            </div>
            <span
              class="shrink-0 font-mono text-[11px] text-subtle"
              title="Ctrl/Cmd+Space for suggestions"
            >
              {query.length} chars
            </span>
          </div>
        </div>
        <SqlCodeEditor
          value={query}
          onChange={onQueryChange}
          onRun={onRun}
          schemaTables={schemaTables}
          editorViewRef={cmViewRef}
          onViewUpdate={() => bumpSelectionTick()}
          onEditorMount={applySearchQuery}
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
            onClick={onCopySql}
            disabled={isRunning || !canShareQuery}
            title="Copy query to the clipboard"
          >
            Copy SQL
          </button>
          <button
            type="button"
            class="btn"
            onClick={onDownloadSql}
            disabled={isRunning || !canShareQuery}
            title="Download the query as a .sql file"
          >
            Save .sql
          </button>
          <button
            type="button"
            class="btn"
            onClick={onDownloadTxt}
            disabled={isRunning || !canShareQuery}
            title="Download the query as a .txt file"
          >
            Save .txt
          </button>
          <span class="ml-auto hidden font-mono text-[10px] text-subtle sm:inline">
            Ctrl+Space · keywords + tables
          </span>
        </div>
      </div>
    </section>
  );
};
