from collections import defaultdict
from collections.abc import Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import jaydebeapi

from src.config import NATIVE_SN_JDBC_DRIVER, settings


@dataclass(frozen=True)
class ConnectionOverride:
    url: str
    user: str
    password: str
    driver_class: str | None = None


def _resolve_connect_params(
    override: ConnectionOverride | None,
) -> tuple[str, str, dict[str, str] | None]:
    """Returns (driver_class, jdbc_url, connect_args)."""

    if override is None:
        return (
            settings.sn_jdbc_driver_class,
            settings.jdbc_url,
            settings.jdbc_driver_args,
        )

    driver_class = override.driver_class or settings.sn_jdbc_driver_class
    url = override.url.strip()

    if driver_class == NATIVE_SN_JDBC_DRIVER:
        args: dict[str, str] = {
            "user": override.user,
            "password": override.password,
            "User": override.user,
            "Password": override.password,
        }
        return driver_class, url, args

    # Simba-style drivers expect credentials inline in the URL.
    if "User=" not in url and "user=" not in url:
        url = url.rstrip(";") + f";User={override.user};Password={override.password};"
    return driver_class, url, None


@contextmanager
def get_connection(override: ConnectionOverride | None = None):
    driver_class, url, args = _resolve_connect_params(override)
    conn = jaydebeapi.connect(
        driver_class,
        url,
        args,
        jars=[settings.sn_jdbc_jar_path],
    )
    try:
        yield conn
    finally:
        conn.close()


def _sanitize_query(query: str) -> str:
    """Normalizes a SQL string for JDBC ``executeQuery``.

    Two transforms are applied:

    1. Strip a trailing ``;`` (any number of them). JDBC's ``executeQuery``
       is a single-statement API and most drivers (Simba ServiceNow included)
       reject queries ending with a terminator. The visual builder and most
       external SQL clients emit one, so we drop it server-side.

    2. Collapse internal whitespace (including newlines/tabs) to single
       spaces. The native ServiceNow JDBC driver
       (``com.snc.db.jdbc.JDBCDriver``) embeds the SQL inside a JSON HTTP
       payload to the instance and does *not* escape control characters;
       a multi-line query therefore produces invalid JSON and the driver
       responds with ``"The payload is not valid JSON"``. SQL is whitespace-
       agnostic outside string literals, so collapsing whitespace keeps the
       semantics intact for typical analytics queries while remaining
       compatible with both the native and Simba drivers.
    """

    cleaned = query.strip()
    while cleaned.endswith(";"):
        cleaned = cleaned[:-1].rstrip()
    # `str.split()` with no args splits on any run of whitespace.
    cleaned = " ".join(cleaned.split())
    return cleaned


def run_query(
    query: str,
    parameters: Sequence[Any] | None = None,
    override: ConnectionOverride | None = None,
) -> dict[str, Any]:
    cleaned_query = _sanitize_query(query)
    if not cleaned_query:
        raise ValueError("Query is empty after stripping terminators.")

    with get_connection(override) as conn:
        curs = conn.cursor()
        try:
            if parameters:
                curs.execute(cleaned_query, parameters)
            else:
                curs.execute(cleaned_query)

            columns = [description[0] for description in (curs.description or [])]
            rows = curs.fetchall()
        finally:
            curs.close()

    return {
        "columns": columns,
        "rows": [list(row) for row in rows],
        "row_count": len(rows),
    }


def _java_connection(conn: Any) -> Any:
    # jaydebeapi exposes the underlying Java connection under different names
    # across versions. Try the public name first, then the private one.
    jconn = getattr(conn, "jconn", None) or getattr(conn, "_jconn", None)
    if jconn is None:
        raise RuntimeError("Cannot access underlying JDBC connection")
    return jconn


def _collect_rs_strings(rs: Any, columns: tuple[str, ...]) -> list[dict[str, Any]]:
    """Walks a JDBC ResultSet and returns rows as dicts of string values."""

    out: list[dict[str, Any]] = []
    try:
        while rs.next():
            row: dict[str, Any] = {column: rs.getString(column) for column in columns}
            out.append(row)
    finally:
        rs.close()
    return out


def list_tables(
    pattern: str | None = None,
    override: ConnectionOverride | None = None,
) -> list[dict[str, Any]]:
    """Returns table metadata via JDBC DatabaseMetaData.getTables."""

    name_pattern = pattern.strip() if pattern else "%"
    if not name_pattern:
        name_pattern = "%"

    with get_connection(override) as conn:
        metadata = _java_connection(conn).getMetaData()
        rs = metadata.getTables(None, None, name_pattern, None)
        rows = _collect_rs_strings(rs, ("TABLE_SCHEM", "TABLE_NAME", "TABLE_TYPE"))

    return [
        {
            "schema": row["TABLE_SCHEM"],
            "name": row["TABLE_NAME"],
            "type": row["TABLE_TYPE"],
        }
        for row in rows
        if row["TABLE_NAME"]
    ]


def _coerce_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_optional_bool(value: Any) -> bool | None:
    """Maps JDBC / Java driver values to ``bool`` or ``None`` (unknown / unread)."""

    if value is None:
        return None
    if isinstance(value, bool):
        return value
    # ``bool`` is a subclass of ``int`` in Python; handle real ints only.
    if type(value) is int or type(value) is float:
        return bool(int(value))
    try:
        from decimal import Decimal

        if isinstance(value, Decimal):
            return bool(int(value))
    except ImportError:
        pass
    lowered = str(value).strip().lower()
    if lowered in ("true", "t", "1", "yes", "y", "on"):
        return True
    if lowered in ("false", "f", "0", "no", "n", "off", ""):
        return False
    if lowered in ("1.0", "0.0"):
        return lowered == "1.0"
    return None


def _dictionary_table_key(table: str) -> str:
    """Table name as stored in ``sys_dictionary.name`` (drops JDBC catalog/schema prefix)."""

    t = table.strip()
    if not t:
        return t
    if "." in t:
        return t.rsplit(".", 1)[-1].strip()
    return t


def _fetch_parent_table_name(conn: Any, table: str) -> str | None:
    """Returns the direct super-class table name for ``table``, if any."""

    query = _sanitize_query(
        "SELECT parent.name FROM sys_db_object child "
        "LEFT JOIN sys_db_object parent ON child.super_class = parent.sys_id "
        "WHERE child.name = ?",
    )
    try:
        curs = conn.cursor()
        try:
            curs.execute(query, [table])
            row = curs.fetchone()
        finally:
            curs.close()
    except Exception:
        return None
    if not row or row[0] is None:
        return None
    name = str(row[0]).strip()
    return name or None


def _fetch_table_chain(conn: Any, start: str) -> list[str]:
    """Table and ancestors (child → … → root) for dictionary lookups."""

    chain: list[str] = []
    current = start.strip()
    seen: set[str] = set()
    while current and current not in seen:
        seen.add(current)
        chain.append(current)
        parent = _fetch_parent_table_name(conn, current)
        if not parent or parent == current:
            break
        current = parent
    return chain if chain else [start.strip()]


def _cursor_query(
    conn: Any,
    sql: str,
    params: Sequence[Any] | None = None,
) -> tuple[list[str], list[Any]] | None:
    """Runs a query and returns ``(column_names, rows)``, or ``None`` on failure."""

    try:
        curs = conn.cursor()
        try:
            if params:
                curs.execute(sql, list(params))
            else:
                curs.execute(sql)
            desc = curs.description
            col_names = [d[0] for d in desc] if desc else []
            raw_rows = curs.fetchall()
        finally:
            curs.close()
    except Exception:
        return None
    return (col_names, raw_rows)


def _dictionary_select_indices(
    col_names: list[str],
    sample_row: Any,
) -> tuple[int, int, int, int] | None:
    """Maps result columns to element, internal_type, function_field, table name.

    ServiceNow JDBC often reorders or re-labels ``cursor.description``; we SELECT
    with fixed aliases ``sn_el`` … ``sn_nm`` so mapping stays stable.
    """

    lowered = [str(c).lower() for c in col_names] if col_names else []

    def find_one(*aliases: str) -> int | None:
        for alias in aliases:
            for i, cn in enumerate(lowered):
                if cn == alias:
                    return i
        return None

    el_i = find_one("sn_el")
    it_i = find_one("sn_it")
    ff_i = find_one("sn_ff")
    nm_i = find_one("sn_nm")
    if None not in (el_i, it_i, ff_i, nm_i):
        return el_i, it_i, ff_i, nm_i

    el_i = find_one("element")
    it_i = find_one("internal_type")
    ff_i = find_one("function_field")
    nm_i = find_one("dict_tab", "dict_table", "name")
    if None not in (el_i, it_i, ff_i, nm_i):
        return el_i, it_i, ff_i, nm_i
    if sample_row is not None and len(sample_row) >= 4:
        return 0, 1, 2, 3
    return None


def _fetch_glide_type_labels(
    conn: Any,
    internal_types: set[str],
) -> dict[str, str]:
    """``internal_type`` value → ``sys_glide_object.label`` (best-effort)."""

    types = sorted({t.strip() for t in internal_types if t and str(t).strip()})
    if not types:
        return {}

    labels: dict[str, str] = {}
    chunk_size = 80
    for offset in range(0, len(types), chunk_size):
        chunk = types[offset : offset + chunk_size]
        placeholders = ", ".join(["?"] * len(chunk))
        sql = _sanitize_query(
            f"SELECT sys_glide_object.name AS sn_gn, sys_glide_object.label AS sn_gl "
            f"FROM sys_glide_object WHERE sys_glide_object.name IN ({placeholders})",
        )
        res = _cursor_query(conn, sql, chunk)
        if not res:
            continue
        col_names, raw_rows = res
        lowered = [str(c).lower() for c in col_names] if col_names else []

        def find_col(*aliases: str) -> int | None:
            for alias in aliases:
                for i, cn in enumerate(lowered):
                    if cn == alias:
                        return i
            return None

        ni = find_col("sn_gn")
        li = find_col("sn_gl")
        if ni is None or li is None:
            ni = find_col("name")
            li = find_col("label")
        if ni is None or li is None:
            if raw_rows and len(raw_rows[0]) >= 2:
                ni, li = 0, 1
            else:
                continue

        for row in raw_rows:
            if len(row) <= max(ni, li):
                continue
            key = _coerce_optional_str(row[ni])
            lab = _coerce_optional_str(row[li])
            if key and lab:
                labels[key.lower()] = lab
    return labels


def _load_sys_dictionary_rows(
    conn: Any,
    chain: list[str],
    table: str,
) -> list[tuple[Any, ...]]:
    """Returns dictionary rows as tuples; prefers ``name IN (…)``, then fallbacks."""

    placeholders = ", ".join(["?"] * len(chain))
    primary_sql = _sanitize_query(
        "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
        "sys_dictionary.function_field AS sn_ff, sys_dictionary.name AS sn_nm "
        "FROM sys_dictionary "
        "WHERE sys_dictionary.element IS NOT NULL "
        "AND (sys_dictionary.inactive = 0 OR sys_dictionary.inactive IS NULL) "
        f"AND sys_dictionary.name IN ({placeholders})",
    )
    res = _cursor_query(conn, primary_sql, chain)
    raw_rows: list[Any] = []
    col_names: list[str] = []
    if res:
        col_names, raw_rows = res

    if not raw_rows:
        plain_in_sql = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, function_field AS sn_ff, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            "AND (inactive = 0 OR inactive IS NULL) "
            f"AND name IN ({placeholders})",
        )
        res = _cursor_query(conn, plain_in_sql, chain)
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        fallback_sql = _sanitize_query(
            "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
            "sys_dictionary.function_field AS sn_ff, sys_dictionary.name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE sys_dictionary.element IS NOT NULL "
            "AND (sys_dictionary.inactive = 0 OR sys_dictionary.inactive IS NULL) "
            "AND sys_dictionary.name = ?",
        )
        res = _cursor_query(conn, fallback_sql, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        lower_sql = _sanitize_query(
            "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
            "sys_dictionary.function_field AS sn_ff, sys_dictionary.name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE sys_dictionary.element IS NOT NULL "
            "AND (sys_dictionary.inactive = 0 OR sys_dictionary.inactive IS NULL) "
            "AND LOWER(sys_dictionary.name) = LOWER(?)",
        )
        res = _cursor_query(conn, lower_sql, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        plain_lower_sql = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, function_field AS sn_ff, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            "AND (inactive = 0 OR inactive IS NULL) "
            "AND LOWER(name) = LOWER(?)",
        )
        res = _cursor_query(conn, plain_lower_sql, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        return []

    sample = raw_rows[0]
    idx = _dictionary_select_indices(col_names, sample)
    if idx is None:
        return []

    el_i, it_i, ff_i, dt_i = idx
    normalized: list[tuple[Any, ...]] = []
    for row in raw_rows:
        if len(row) <= max(el_i, it_i, ff_i, dt_i):
            continue
        normalized.append(
            (
                row[el_i],
                row[it_i],
                row[ff_i],
                row[dt_i],
            )
        )
    return normalized


# JDBC ``getColumns`` sometimes reports these as physical columns even when they
# are not dictionary-backed fields on the table (or dictionary reads fail).
JDBC_METADATA_PHANTOM_ELEMENTS = frozenset(
    {
        "sys_tags",
    },
)


def _jdbc_allowlist_from_dictionary_raw(
    raw: list[tuple[Any, ...]],
) -> frozenset[str]:
    """Element names that look like real dictionary fields (typed or boolean flag)."""

    names: set[str] = set()
    for el_raw, it_raw, ff_raw, _dt in raw:
        if el_raw is None:
            continue
        key = str(el_raw).strip().lower()
        if not key:
            continue
        internal = _coerce_optional_str(it_raw)
        ff = _coerce_optional_bool(ff_raw)
        if internal or ff is not None:
            names.add(key)
    return frozenset(names)


def _jdbc_element_names_from_dictionary_raw(raw: list[tuple[Any, ...]]) -> frozenset[str]:
    """Every non-empty ``element`` from dictionary rows (inactive already filtered in SQL)."""

    names: set[str] = set()
    for el_raw, *_rest in raw:
        if el_raw is None:
            continue
        key = str(el_raw).strip().lower()
        if key:
            names.add(key)
    return frozenset(names)


def _fetch_sys_dictionary_meta(
    conn: Any,
    table: str,
) -> tuple[dict[str, dict[str, Any]], frozenset[str]]:
    """Maps lowercased ``element`` → metadata, and which elements are real fields.

    Returns ``(meta_by_element, jdbc_filter)``. ``jdbc_filter`` is used to drop
    JDBC-only columns: prefer typed/flagged dictionary elements; if that set is
    empty but dictionary rows exist, fall back to all dictionary ``element``
    names. Known JDBC phantoms (e.g. ``sys_tags``) are removed from the filter set.

    Loads ``sys_dictionary`` without joining ``sys_glide_object`` in the same
    statement (some ServiceNow JDBC setups reject that join or return no
    rows). Human-readable types come from a follow-up ``sys_glide_object``
    query when possible.

    Uses the table's ``sys_db_object`` inheritance chain so parent fields
    resolve. Matching is case-insensitive on dictionary table names.
    """

    chain = _fetch_table_chain(conn, table)
    if not chain:
        return {}, frozenset()

    priority = {t.lower(): i for i, t in enumerate(chain)}
    raw = _load_sys_dictionary_rows(conn, chain, table.strip())
    if not raw:
        return {}, frozenset()

    jdbc_allow = _jdbc_allowlist_from_dictionary_raw(raw)
    all_elements = _jdbc_element_names_from_dictionary_raw(raw)
    strict_cut = frozenset(jdbc_allow - JDBC_METADATA_PHANTOM_ELEMENTS)
    fallback_cut = frozenset(all_elements - JDBC_METADATA_PHANTOM_ELEMENTS)
    if strict_cut:
        jdbc_filter = strict_cut
    elif fallback_cut:
        jdbc_filter = fallback_cut
    else:
        jdbc_filter = frozenset()

    internal_types: set[str] = set()
    by_element: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for el_raw, it_raw, ff_raw, dt_raw in raw:
        if el_raw is None:
            continue
        key = str(el_raw).strip().lower()
        if not key:
            continue
        internal = _coerce_optional_str(it_raw)
        if internal:
            internal_types.add(internal)
        dt_key = str(dt_raw).strip().lower() if dt_raw is not None else ""
        by_element[key].append(
            {
                "internal_type": internal,
                "function_field": _coerce_optional_bool(ff_raw),
                "dict_table": dt_key,
            }
        )

    glide_labels = _fetch_glide_type_labels(conn, internal_types)

    out: dict[str, dict[str, Any]] = {}
    for key, cands in by_element.items():
        cands.sort(
            key=lambda c: priority.get(str(c.get("dict_table") or ""), 999),
        )
        pick = cands[0]
        internal = pick.get("internal_type")
        ff = pick.get("function_field")
        if ff is None:
            # Instance UI treats missing flag as "not a function field" (false).
            ff = False
        label = None
        if isinstance(internal, str) and internal.strip():
            label = glide_labels.get(internal.strip().lower())
        field_type = label or internal
        out[key] = {
            "internal_type": internal,
            "function_field": ff,
            "field_type": field_type,
        }
    return out, jdbc_filter


def list_columns(
    table: str,
    override: ConnectionOverride | None = None,
) -> list[dict[str, Any]]:
    """Returns column metadata via JDBC ``getColumns``, enriched from ``sys_dictionary``.

    When dictionary rows exist, JDBC columns are intersected with
    ``jdbc_filter`` so driver-only columns are dropped. Inactive dictionary rows
    are ignored. See ``JDBC_METADATA_PHANTOM_ELEMENTS``.
    """

    cleaned = table.strip()
    if not cleaned:
        return []

    with get_connection(override) as conn:
        jconn = _java_connection(conn)
        metadata = jconn.getMetaData()
        rs = metadata.getColumns(None, None, cleaned, "%")
        rows: list[dict[str, Any]] = []
        try:
            while rs.next():
                rows.append(
                    {
                        "name": rs.getString("COLUMN_NAME"),
                        "type": rs.getString("TYPE_NAME"),
                        "nullable": int(rs.getInt("NULLABLE") or 0) == 1,
                    }
                )
        finally:
            rs.close()

        dict_meta, jdbc_filter = _fetch_sys_dictionary_meta(
            conn,
            _dictionary_table_key(cleaned),
        )

    merged: list[dict[str, Any]] = []
    for row in rows:
        name = row.get("name")
        if not name:
            continue
        lk = str(name).strip().lower()
        dm = dict_meta.get(lk, {})
        ff_val = dm.get("function_field")
        if ff_val is None and lk in dict_meta:
            ff_val = False
        merged.append(
            {
                **row,
                "internal_type": dm.get("internal_type"),
                "field_type": dm.get("field_type"),
                "function_field": ff_val,
            }
        )

    # JDBC ``getColumns`` exposes driver/system columns (e.g. ``sys_tags``) that
    # are not real dictionary fields. Intersect with dictionary elements when we
    # have any; strip known JDBC phantoms (see ``JDBC_METADATA_PHANTOM_ELEMENTS``).
    if jdbc_filter:
        merged = [
            m
            for m in merged
            if str(m.get("name", "")).strip().lower() in jdbc_filter
        ]

    return merged
