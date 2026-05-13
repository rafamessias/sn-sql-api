import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  SERVER_DEFAULT_ID,
  STORAGE_KEYS,
  connectionInstanceLabel,
  deriveConnectionName,
  type ConnectionFormState,
  type SavedConnection,
  generateId,
} from "../lib/connections";

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readConnections = (): SavedConnection[] => {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEYS.connections);
  const list = safeParse<SavedConnection[]>(raw, []);
  return list.map((c) => ({
    ...c,
    name: deriveConnectionName(c.url) || c.name,
  }));
};

const readActiveId = (): string => {
  if (typeof window === "undefined") return SERVER_DEFAULT_ID;
  return (
    window.localStorage.getItem(STORAGE_KEYS.activeId) ?? SERVER_DEFAULT_ID
  );
};

export const useConnections = () => {
  const [connections, setConnections] = useState<SavedConnection[]>(() =>
    readConnections(),
  );
  const [activeId, setActiveIdState] = useState<string>(() => readActiveId());

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.connections,
        JSON.stringify(connections),
      );
    } catch {
      // ignore quota issues; data is still in memory for the session
    }
  }, [connections]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.activeId, activeId);
    } catch {
      // ignore
    }
  }, [activeId]);

  const setActiveId = useCallback((next: string) => {
    setActiveIdState(next || SERVER_DEFAULT_ID);
  }, []);

  const createConnection = useCallback(
    (form: ConnectionFormState): SavedConnection => {
      const created: SavedConnection = { id: generateId(), ...form };
      setConnections((prev) => [...prev, created]);
      return created;
    },
    [],
  );

  const updateConnection = useCallback(
    (id: string, form: ConnectionFormState) => {
      setConnections((prev) =>
        prev.map((entry) => (entry.id === id ? { id, ...form } : entry)),
      );
    },
    [],
  );

  const removeConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((entry) => entry.id !== id));
    setActiveIdState((current) => (current === id ? SERVER_DEFAULT_ID : current));
  }, []);

  const replaceAll = useCallback((next: SavedConnection[]) => {
    setConnections(next);
  }, []);

  const mergeImport = useCallback((incoming: SavedConnection[]) => {
    setConnections((prev) => {
      const keyOf = (e: SavedConnection) => connectionInstanceLabel(e);
      const byKey = new Map(prev.map((entry) => [keyOf(entry), entry]));
      for (const entry of incoming) {
        const k = keyOf(entry);
        byKey.set(k, {
          ...entry,
          id: byKey.get(k)?.id ?? entry.id,
        });
      }
      return Array.from(byKey.values());
    });
  }, []);

  const active = useMemo(
    () => connections.find((entry) => entry.id === activeId) ?? null,
    [connections, activeId],
  );

  return {
    connections,
    activeId,
    active,
    setActiveId,
    createConnection,
    updateConnection,
    removeConnection,
    replaceAll,
    mergeImport,
  };
};
