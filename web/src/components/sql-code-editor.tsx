import { useEffect, useRef } from "preact/hooks";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  type Panel,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { sql, StandardSQL, type SQLNamespace } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import { search, searchKeymap } from "@codemirror/search";

/** CodeMirror only paints search highlights while a search panel is registered; host is visually hidden. */
function invisibleSearchPanelHost(_view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.setAttribute("aria-hidden", "true");
  dom.style.cssText =
    "height:0;overflow:hidden;position:absolute;width:1px;clip:rect(0,0,0,0);pointer-events:none;";
  return { dom, top: false };
}

const PLACEHOLDER =
  "SELECT number, short_description, sys_created_on FROM incident LIMIT 100";

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7b72", fontWeight: "500" },
  { tag: tags.operator, color: "#79c0ff" },
  { tag: tags.bracket, color: "#8b949e" },
  { tag: tags.name, color: "#e6edf3" },
  { tag: tags.variableName, color: "#ffa657" },
  { tag: tags.propertyName, color: "#79c0ff" },
  { tag: tags.literal, color: "#a5d6ff" },
  { tag: tags.string, color: "#a5d6ff" },
  { tag: tags.number, color: "#d2a8ff" },
  { tag: tags.bool, color: "#d2a8ff" },
  { tag: tags.null, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.meta, color: "#8b949e" },
  { tag: tags.typeName, color: "#ffa657" },
  { tag: tags.className, color: "#ffa657" },
]);

const editorTheme = EditorView.theme(
  {
    "&": {
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#010409",
      color: "#e6edf3",
      fontSize: "13px",
      minWidth: 0,
      width: "100%",
      maxWidth: "100%",
      height: "100%",
      minHeight: 0,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'IBM Plex Mono', monospace",
    },
    ".cm-content": {
      caretColor: "#3fb950",
      padding: "16px 20px",
      // Match parent (scroll area) height; lines extend below → vertical scroll on .cm-scroller
      minHeight: "100%",
      // Default CM uses flexShrink: 0, so longest line’s width becomes min-width of the whole
      // page (~40k px). Shrink inside .cm-scroller and rely on overflow-x (same idea as lineWrapping).
      minWidth: "0",
      flexShrink: "1",
    },
    ".cm-scroller": {
      minWidth: 0,
      minHeight: 0,
      flex: 1,
      width: "100%",
      maxWidth: "100%",
      overflowX: "scroll",
      overflowY: "auto",
      fontFamily: "inherit",
      scrollbarGutter: "stable",
      scrollbarWidth: "auto",
      scrollbarColor: "#7d8590 #21262d",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "14px",
      height: "14px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      backgroundColor: "#161b22",
      borderTop: "1px solid #30363d",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "#6e7681",
      borderRadius: "8px",
      border: "3px solid #161b22",
      backgroundClip: "padding-box",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "#8b949e",
    },
    ".cm-scroller::-webkit-scrollbar-corner": {
      backgroundColor: "#161b22",
    },
    ".cm-gutters": {
      backgroundColor: "#010409",
      color: "#6e7681",
      border: "none",
      borderRight: "1px solid #30363d",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#161b22",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(63, 185, 80, 0.06)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#3fb950",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(63, 185, 80, 0.2) !important",
    },
    "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
      backgroundColor: "rgba(63, 185, 80, 0.25) !important",
    },
    ".cm-tooltip": {
      backgroundColor: "#161b22",
      border: "1px solid #30363d",
      borderRadius: "6px",
      color: "#e6edf3",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(63, 185, 80, 0.15)",
      color: "#3fb950",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(255, 193, 7, 0.22)",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "rgba(63, 185, 80, 0.38)",
      outline: "1px solid rgba(63, 185, 80, 0.6)",
    },
  },
  { dark: true },
);

function buildSchema(
  tables: readonly string[] | undefined,
): SQLNamespace | undefined {
  if (!tables?.length) return undefined;
  return Object.fromEntries(
    tables.map((name) => [name, [] as readonly string[]]),
  ) as SQLNamespace;
}

function sqlSupport(schemaTables: readonly string[] | undefined) {
  return sql({
    dialect: StandardSQL,
    upperCaseKeywords: true,
    schema: buildSchema(schemaTables),
  });
}

function baseExtensions(
  sqlCompartment: Compartment,
  schemaTables: readonly string[] | undefined,
  onRun: () => void,
): Extension[] {
  return [
    editorTheme,
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 50,
    }),
    sqlCompartment.of(sqlSupport(schemaTables)),
    syntaxHighlighting(sqlHighlightStyle, { fallback: true }),
    placeholder(PLACEHOLDER),
    search({ literal: true, createPanel: invisibleSearchPanelHost }),
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onRun();
          return true;
        },
      },
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...searchKeymap,
    ]),
  ];
}

export type SqlCodeEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  /** Table names from schema discovery — improves FROM / JOIN autocomplete */
  schemaTables?: readonly string[];
  /** Filled when the CodeMirror instance is mounted (cleared on unmount). */
  editorViewRef?: { current: EditorView | null };
  /** Called after doc/selection/viewport updates (for search UI sync). */
  onViewUpdate?: () => void;
  /** Called once after the CodeMirror view is created. */
  onEditorMount?: () => void;
};

export const SqlCodeEditor = ({
  value,
  onChange,
  onRun,
  schemaTables,
  editorViewRef,
  onViewUpdate,
  onEditorMount,
}: SqlCodeEditorProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartmentRef = useRef<Compartment | null>(null);
  if (!sqlCompartmentRef.current) sqlCompartmentRef.current = new Compartment();

  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onViewUpdateRef = useRef(onViewUpdate);
  const onEditorMountRef = useRef(onEditorMount);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onViewUpdateRef.current = onViewUpdate;
  onEditorMountRef.current = onEditorMount;

  useEffect(() => {
    const host = hostRef.current;
    const sqlCompartment = sqlCompartmentRef.current;
    if (!host || !sqlCompartment) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions(sqlCompartment, schemaTables, () => onRunRef.current()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged
          ) {
            onViewUpdateRef.current?.();
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (editorViewRef) editorViewRef.current = view;
    queueMicrotask(() => {
      onEditorMountRef.current?.();
      onViewUpdateRef.current?.();
    });

    return () => {
      view.destroy();
      viewRef.current = null;
      if (editorViewRef) editorViewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    const sqlCompartment = sqlCompartmentRef.current;
    if (!view || !sqlCompartment) return;
    view.dispatch({
      effects: sqlCompartment.reconfigure(sqlSupport(schemaTables)),
    });
  }, [schemaTables]);

  return (
    <div
      ref={hostRef}
      class="sql-cm-host contain-inline-size flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col [&_.cm-editor]:flex [&_.cm-editor]:min-h-0 [&_.cm-editor]:min-w-0 [&_.cm-editor]:flex-1 [&_.cm-editor]:flex-col [&_.cm-editor]:outline-none"
    />
  );
};
