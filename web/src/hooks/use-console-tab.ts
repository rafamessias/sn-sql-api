import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { TabId } from "../components/tabs";

const STORAGE_KEY = "sn-sql-api-console-tab";

const TAB_PATHS: Record<TabId, string> = {
  editor: "/editor",
  schema: "/schema",
  connections: "/connections",
  logs: "/logs",
};

const PATH_TO_TAB: Record<string, TabId> = {
  "/editor": "editor",
  "/schema": "schema",
  "/connections": "connections",
  "/logs": "logs",
};

const rawBase = import.meta.env.BASE_URL ?? "/";
const basePrefix = rawBase.replace(/\/$/, "");

const fullPathForTab = (tab: TabId): string => `${basePrefix}${TAB_PATHS[tab]}`;

const pathnameToTab = (pathname: string): TabId | null => {
  let rel = pathname;
  if (basePrefix && pathname.startsWith(basePrefix)) {
    rel = pathname.slice(basePrefix.length) || "/";
  }
  const key = rel.length > 1 && rel.endsWith("/") ? rel.slice(0, -1) : rel;
  if (key === "/" || key === "") return null;
  return PATH_TO_TAB[key] ?? null;
};

const loadSavedTab = (): TabId => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "editor" || raw === "schema" || raw === "connections" || raw === "logs") {
      return raw;
    }
  } catch {
    /* private mode or quota */
  }
  return "editor";
};

const persistTab = (tab: TabId): void => {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
};

export const useConsoleTab = (): [TabId, (tab: TabId) => void] => {
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    if (typeof window === "undefined") return "editor";
    const fromUrl = pathnameToTab(window.location.pathname);
    return fromUrl ?? loadSavedTab();
  });
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    persistTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (pathnameToTab(window.location.pathname) !== null) return;
    const tab = activeTabRef.current;
    const target = fullPathForTab(tab);
    if (window.location.pathname !== target) {
      window.history.replaceState({ tab }, "", target);
    }
  }, []);

  useEffect(() => {
    const syncFromLocation = (): void => {
      const fromUrl = pathnameToTab(window.location.pathname);
      if (fromUrl !== null) {
        setActiveTabState(fromUrl);
        return;
      }
      const next = loadSavedTab();
      setActiveTabState(next);
      const target = fullPathForTab(next);
      if (window.location.pathname !== target) {
        window.history.replaceState({ tab: next }, "", target);
      }
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    const target = fullPathForTab(tab);
    if (window.location.pathname !== target) {
      window.history.pushState({ tab }, "", target);
    }
  }, []);

  return [activeTab, setActiveTab];
};
