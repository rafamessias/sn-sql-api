import { useEffect, useRef } from "preact/hooks";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
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

const snippetHighlight = HighlightStyle.define([
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
  { tag: tags.typeName, color: "#ffa657" },
]);

const snippetTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#0d1117",
      color: "#e6edf3",
      fontSize: "12px",
      minWidth: 0,
      width: "100%",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'IBM Plex Mono', monospace",
    },
    ".cm-content": {
      caretColor: "#3fb950",
      padding: "8px 12px",
      minHeight: "4.5rem",
    },
    ".cm-scroller": {
      minHeight: "4.5rem",
      overflow: "auto",
      fontFamily: "inherit",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#3fb950",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(26, 68, 34, 0.45) !important",
    },
    "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
      backgroundColor: "rgba(26, 68, 34, 0.55) !important",
    },
    ".cm-tooltip": {
      backgroundColor: "#161b22",
      border: "1px solid #30363d",
      borderRadius: "6px",
      color: "#e6edf3",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(26, 68, 34, 0.35)",
      color: "#3fb950",
    },
  },
  { dark: true },
);

function buildSchema(
  table: string | null | undefined,
  columns: readonly string[],
): SQLNamespace | undefined {
  const t = table?.trim();
  if (!t) return undefined;
  const cols = [...new Set(columns.map((c) => c.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return { [t]: cols } as SQLNamespace;
}

function sqlSupport(
  table: string | null | undefined,
  columnNames: readonly string[],
) {
  const t = table?.trim();
  const schema = buildSchema(table, columnNames);
  return sql({
    dialect: StandardSQL,
    upperCaseKeywords: true,
    schema,
    // Without a FROM clause, the parser does not know the table; this exposes
    // that table's columns at the top level (see SQLConfig.defaultTable).
    defaultTable: t || undefined,
  });
}

function baseExtensions(
  sqlCompartment: Compartment,
  table: string | null | undefined,
  columnNames: readonly string[],
  placeText: string,
): Extension[] {
  return [
    snippetTheme,
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 40,
    }),
    sqlCompartment.of(sqlSupport(table, columnNames)),
    syntaxHighlighting(snippetHighlight, { fallback: true }),
    placeholder(placeText),
    keymap.of([
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
    ]),
  ];
}

export type SchemaSnippetEditorProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Active table — ``defaultTable`` so its columns complete without a FROM clause */
  schemaTable: string | null;
  /** Column names on ``schemaTable`` (reserved SQL words come from the dialect) */
  columnNames: readonly string[];
  "aria-label"?: string;
};

export const SchemaSnippetEditor = ({
  value,
  onChange,
  placeholder: placeText,
  schemaTable,
  columnNames,
  "aria-label": ariaLabel,
}: SchemaSnippetEditorProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartmentRef = useRef<Compartment | null>(null);
  if (!sqlCompartmentRef.current) sqlCompartmentRef.current = new Compartment();

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    const sqlCompartment = sqlCompartmentRef.current;
    if (!host || !sqlCompartment) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions(
          sqlCompartment,
          schemaTable,
          columnNames,
          placeText,
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
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

  const schemaKey = `${schemaTable ?? ""}\n${columnNames.join("\0")}`;
  useEffect(() => {
    const view = viewRef.current;
    const sqlCompartment = sqlCompartmentRef.current;
    if (!view || !sqlCompartment) return;
    view.dispatch({
      effects: sqlCompartment.reconfigure(
        sqlSupport(schemaTable, columnNames),
      ),
    });
  }, [schemaKey]);

  return (
    <div
      ref={hostRef}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      class="schema-snippet-cm min-h-[4.5rem] min-w-0 w-full overflow-hidden rounded-md border border-border bg-bg [&_.cm-editor]:min-h-[4.5rem] [&_.cm-editor]:outline-none [&_.cm-scroller]:min-h-[4.5rem]"
    />
  );
};
