import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { cn } from "../lib/cn";
import type { EditorTab } from "../lib/editor-tabs";

type EditorTabsBarProps = {
  tabs: EditorTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAdd: () => void;
};

export const EditorTabsBar = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onRename,
  onAdd,
}: EditorTabsBarProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Escape removes the input; blur can still fire on unmount — skip persisting that rename. */
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const commit = (id: string, value: string) => {
    onRename(id, value);
    setEditingId(null);
  };

  const handleKey =
    (id: string): JSX.KeyboardEventHandler<HTMLInputElement> =>
    (event) => {
      const target = event.target as HTMLInputElement;
      if (event.key === "Enter") {
        event.preventDefault();
        commit(id, target.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        skipBlurCommitRef.current = true;
        setEditingId(null);
      }
    };

  return (
    <div class="flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isEditing = editingId === tab.id;
        return (
          <div
            key={tab.id}
            class={cn(
              "group flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors",
              isActive
                ? "border-accent bg-accent-dim/40 text-accent"
                : "border-border bg-surface text-muted hover:text-text",
            )}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                class="min-w-[7rem] max-w-[240px] flex-1 bg-transparent text-text outline-none"
                defaultValue={tab.name}
                onBlur={(event) => {
                  if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                    return;
                  }
                  commit(tab.id, (event.target as HTMLInputElement).value);
                }}
                onKeyDown={handleKey(tab.id)}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSelect(tab.id)}
                  onDblClick={() => setEditingId(tab.id)}
                  title={`${tab.name} — double-click or use Rename to edit`}
                  class="max-w-[180px] truncate text-left"
                >
                  {tab.name}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(tab.id);
                    setEditingId(tab.id);
                  }}
                  class={cn(
                    "shrink-0 rounded p-0.5 transition-opacity focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                    isActive
                      ? "text-accent/80 hover:text-accent opacity-100"
                      : "text-subtle opacity-0 hover:text-text group-hover:opacity-100",
                  )}
                  aria-label={`Rename ${tab.name}`}
                  title="Rename tab"
                >
                  <svg
                    aria-hidden="true"
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              class={cn(
                "rounded px-1 text-[14px] leading-none transition-colors",
                isActive
                  ? "text-accent hover:text-danger"
                  : "text-subtle hover:text-danger",
              )}
              aria-label={`Close ${tab.name}`}
              title="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        class="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[13px] leading-none text-muted transition-colors hover:border-accent hover:text-accent"
        title="New tab"
        aria-label="New tab"
      >
        +
      </button>
    </div>
  );
};
