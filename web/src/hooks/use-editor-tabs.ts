import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  DEFAULT_QUERY,
  LEGACY_QUERY_KEY,
  STORAGE_KEYS,
  defaultTab,
  generateTabId,
  sanitizeTabs,
  type EditorTab,
} from "../lib/editor-tabs";

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const LEGACY_GLOBAL_COMPARE_KEY = "sn-sql-api:editor:compareTableApi:v1";

const loadInitialTabs = (): EditorTab[] => {
  if (typeof window === "undefined") return [defaultTab()];
  const stored = safeParse<unknown>(
    window.localStorage.getItem(STORAGE_KEYS.tabs),
  );
  let tabs = sanitizeTabs(stored);
  if (!tabs || tabs.length === 0) {
    const legacy = window.localStorage.getItem(LEGACY_QUERY_KEY);
    if (legacy && legacy.trim()) {
      return [{ id: generateTabId(), name: "Query 1", query: legacy }];
    }
    return [defaultTab()];
  }

  try {
    const legacyLs = window.localStorage.getItem(LEGACY_GLOBAL_COMPARE_KEY);
    const legacySs = window.sessionStorage.getItem(LEGACY_GLOBAL_COMPARE_KEY);
    const hadPerTabCompare = tabs.some(
      (t) => typeof t.compareTableApi === "boolean",
    );
    if (
      !hadPerTabCompare &&
      (legacyLs === "1" || legacySs === "1")
    ) {
      tabs = tabs.map((t, i) =>
        i === 0 ? { ...t, compareTableApi: true } : t,
      );
    }
    window.localStorage.removeItem(LEGACY_GLOBAL_COMPARE_KEY);
    window.sessionStorage.removeItem(LEGACY_GLOBAL_COMPARE_KEY);
  } catch {
    /* ignore */
  }

  return tabs;
};

const loadActiveId = (tabs: EditorTab[]): string => {
  if (typeof window === "undefined") return tabs[0]?.id ?? "";
  const stored = window.localStorage.getItem(STORAGE_KEYS.activeId);
  if (stored && tabs.some((t) => t.id === stored)) return stored;
  return tabs[0]?.id ?? "";
};

export const useEditorTabs = () => {
  const [tabs, setTabs] = useState<EditorTab[]>(loadInitialTabs);
  const [activeId, setActiveIdState] = useState<string>(() =>
    loadActiveId(tabs),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.tabs, JSON.stringify(tabs));
    } catch {
      // ignore quota / availability issues
    }
  }, [tabs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.activeId, activeId);
    } catch {
      // ignore
    }
  }, [activeId]);

  const activeTab = useMemo(
    () => tabs.find((entry) => entry.id === activeId) ?? tabs[0] ?? defaultTab(),
    [tabs, activeId],
  );

  const updateTab = useCallback(
    (id: string, patch: Partial<EditorTab>) => {
      setTabs((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      );
    },
    [],
  );

  const setActiveQuery = useCallback(
    (query: string) => {
      updateTab(activeId, { query });
    },
    [activeId, updateTab],
  );

  const renameTab = useCallback(
    (id: string, name: string) => {
      updateTab(id, { name: name.trim() || "Query" });
    },
    [updateTab],
  );

  const setLastRunDurationMs = useCallback(
    (id: string, durationMs: number) => {
      const rounded = Math.max(0, Math.round(durationMs));
      updateTab(id, { lastRunDurationMs: rounded });
    },
    [updateTab],
  );

  const setLastTableApiRunTimes = useCallback(
    (id: string, browserMs: number, instanceMs: number) => {
      updateTab(id, {
        lastTableApiBrowserMs: Math.max(0, Math.round(browserMs)),
        lastTableApiInstanceMs: Math.max(0, Math.round(instanceMs)),
      });
    },
    [updateTab],
  );

  const setCompareTableApi = useCallback(
    (id: string, enabled: boolean) => {
      updateTab(id, { compareTableApi: enabled });
    },
    [updateTab],
  );

  const nextDefaultName = useCallback(
    (existing: EditorTab[]): string => {
      let n = existing.length + 1;
      while (existing.some((entry) => entry.name === `Query ${n}`)) n += 1;
      return `Query ${n}`;
    },
    [],
  );

  const addTab = useCallback(
    (init?: Partial<EditorTab>): EditorTab => {
      let created: EditorTab | null = null;
      setTabs((prev) => {
        const id = init?.id ?? generateTabId();
        const newTab: EditorTab = {
          id,
          name: init?.name ?? nextDefaultName(prev),
          query: init?.query ?? DEFAULT_QUERY,
        };
        created = newTab;
        return [...prev, newTab];
      });
      // setActiveId after the setTabs callback resolves
      if (created) {
        setActiveIdState((created as EditorTab).id);
        return created;
      }
      // Fallback (should not happen)
      return defaultTab();
    },
    [nextDefaultName],
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((entry) => entry.id === id);
      if (idx === -1) return prev;
      const filtered = prev.filter((entry) => entry.id !== id);
      if (filtered.length === 0) {
        const seed = defaultTab();
        setActiveIdState(seed.id);
        return [seed];
      }
      setActiveIdState((current) => {
        if (current !== id) return current;
        const fallback = prev[idx + 1] ?? prev[idx - 1] ?? filtered[0];
        return fallback.id;
      });
      return filtered;
    });
  }, []);

  return {
    tabs,
    activeId,
    activeTab,
    setActiveId: setActiveIdState,
    setActiveQuery,
    renameTab,
    setLastRunDurationMs,
    setLastTableApiRunTimes,
    setCompareTableApi,
    addTab,
    closeTab,
  };
};
