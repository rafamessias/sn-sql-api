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
                class="w-32 bg-transparent text-text outline-none"
                defaultValue={tab.name}
                onBlur={(event) =>
                  commit(tab.id, (event.target as HTMLInputElement).value)
                }
                onKeyDown={handleKey(tab.id)}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                onDblClick={() => setEditingId(tab.id)}
                title={`${tab.name} — double-click to rename`}
                class="max-w-[180px] truncate text-left"
              >
                {tab.name}
              </button>
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
