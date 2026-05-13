import { cn } from "../lib/cn";

export type TabId = "editor" | "schema" | "connections" | "logs";

type TabSpec = {
  id: TabId;
  label: string;
  badge?: string | number;
};

type TabsProps = {
  active: TabId;
  onChange: (next: TabId) => void;
  tabs: TabSpec[];
};

export const Tabs = ({ active, onChange, tabs }: TabsProps) => (
  <nav
    role="tablist"
    aria-label="Console sections"
    class="border-b border-border bg-bg"
  >
    <div class="mx-auto flex w-full max-w-[1400px] items-center gap-1 px-4">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            class={cn(
              "relative flex items-center gap-2 px-4 py-2 font-mono text-[12px] transition-colors",
              "border-b-2 -mb-px",
              isActive
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== "" && (
              <span class="rounded-full border border-border bg-surface-2 px-1.5 py-px text-[10px] text-subtle">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </nav>
);
