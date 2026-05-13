import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Header } from "./components/header";
import { Tabs } from "./components/tabs";
import { EditorPanel } from "./components/editor-panel";
import { SchemaPanel } from "./components/schema-panel";
import { ConnectionsPanel } from "./components/connections-panel";
import { EasterEgg } from "./components/easter-egg";
import { Footer } from "./components/footer";
import { LogsPanel } from "./components/logs-panel";
import { useConnections } from "./hooks/use-connections";
import { useConsoleTab } from "./hooks/use-console-tab";
import { useEditorTabs } from "./hooks/use-editor-tabs";
import { deriveTabName } from "./lib/editor-tabs";
import { SERVER_DEFAULT_ID, connectionInstanceLabel, toPayload } from "./lib/connections";

export const App = () => {
  const [activeTab, setActiveTab] = useConsoleTab();
  const [schemaTables, setSchemaTables] = useState<string[]>([]);

  const {
    tabs: editorTabs,
    activeId: editorActiveId,
    activeTab: editorActiveTab,
    setActiveId: selectEditorTab,
    setActiveQuery,
    renameTab: renameEditorTab,
    setLastRunDurationMs: setEditorTabLastRunDurationMs,
    addTab: addEditorTab,
    closeTab: closeEditorTab,
  } = useEditorTabs();

  const {
    connections,
    activeId,
    active,
    setActiveId,
    createConnection,
    updateConnection,
    removeConnection,
    mergeImport,
  } = useConnections();

  const connectionPayload = useMemo(
    () => (active ? toPayload(active) : undefined),
    [active],
  );

  const connectionKey = useMemo(
    () =>
      connectionPayload
        ? `${connectionPayload.url}::${connectionPayload.user}`
        : "__default__",
    [connectionPayload],
  );

  useEffect(() => {
    setSchemaTables([]);
  }, [connectionKey]);

  const connectionLabel = useMemo(
    () =>
      activeId === SERVER_DEFAULT_ID || !active
        ? ".env"
        : connectionInstanceLabel(active),
    [activeId, active],
  );

  const handleTablesDiscovered = useCallback((names: readonly string[]) => {
    setSchemaTables([...names]);
  }, []);

  const handleSendToEditor = useCallback(
    (sql: string) => {
      if (!sql) return;
      addEditorTab({ name: deriveTabName(sql), query: sql });
      setActiveTab("editor");
    },
    [addEditorTab],
  );

  const handleNewEditorTab = useCallback(() => {
    addEditorTab({ query: "" });
  }, [addEditorTab]);

  return (
    <div class="flex h-full min-h-screen flex-col">
      <Header
        connections={connections}
        activeId={activeId}
        onActiveIdChange={setActiveId}
      />

      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "editor", label: "Editor", badge: editorTabs.length },
          { id: "schema", label: "Schema" },
          { id: "connections", label: "Connections", badge: connections.length },
          { id: "logs", label: "Logs" },
        ]}
      />

      <main class="mx-auto flex min-h-0 min-w-0 w-full max-w-[1400px] flex-1 flex-col px-6 py-5">
        {activeTab === "editor" && (
          <>
            <div class="mb-2 flex shrink-0 items-center justify-end text-[11px] text-subtle">
              <span class="mr-2">Run with</span>
              <kbd class="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
                Ctrl
              </kbd>
              <span class="px-1">+</span>
              <kbd class="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
                Enter
              </kbd>
            </div>
            <EditorPanel
              tabs={editorTabs}
              activeId={editorActiveId}
              activeTab={editorActiveTab}
              onSelectTab={selectEditorTab}
              onCloseTab={closeEditorTab}
              onRenameTab={renameEditorTab}
              onAddTab={handleNewEditorTab}
              onActiveQueryChange={setActiveQuery}
              onLastSuccessfulRunDuration={setEditorTabLastRunDurationMs}
              connectionPayload={connectionPayload}
              connectionLabel={connectionLabel}
              schemaTables={schemaTables}
            />
          </>
        )}

        {activeTab === "schema" && (
          <SchemaPanel
            connectionPayload={connectionPayload}
            onSendToEditor={handleSendToEditor}
            onTablesDiscovered={handleTablesDiscovered}
          />
        )}

        {activeTab === "connections" && (
          <ConnectionsPanel
            connections={connections}
            activeId={activeId}
            onSetActive={setActiveId}
            onCreate={createConnection}
            onUpdate={updateConnection}
            onRemove={removeConnection}
            onMergeImport={mergeImport}
          />
        )}

        {activeTab === "logs" && <LogsPanel />}
      </main>

      <Footer />
      <EasterEgg />
    </div>
  );
};
