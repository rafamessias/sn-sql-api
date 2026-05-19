import re
import time
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


_LIMIT_OFFSET_TAIL_RE = re.compile(
    r"\s+LIMIT\s+(\d+)\s*(?:OFFSET\s+(\d+))?\s*$",
    re.IGNORECASE,
)
_OFFSET_LIMIT_TAIL_RE = re.compile(
    r"\s+OFFSET\s+(\d+)\s+LIMIT\s+(\d+)\s*$",
    re.IGNORECASE,
)


def _parse_trailing_limit_offset(cleaned_query: str) -> tuple[str, int | None, int]:
    m = _LIMIT_OFFSET_TAIL_RE.search(cleaned_query)
    if m:
        base = cleaned_query[: m.start()].rstrip()
        return base, int(m.group(1)), int(m.group(2) or 0)

    m = _OFFSET_LIMIT_TAIL_RE.search(cleaned_query)
    if m:
        base = cleaned_query[: m.start()].rstrip()
        return base, int(m.group(2)), int(m.group(1))

    return cleaned_query, None, 0


def _page_sql(base_sql: str, limit: int, offset: int) -> str:
    wrapped = f"SELECT * FROM ({base_sql}) sn_sql_api_page"
    return f"{wrapped} LIMIT {limit} OFFSET {offset}"


def _column_tail(name: str) -> str:
    return name.strip().lower().rsplit(".", 1)[-1]


def _align_page_rows(
    first_columns: list[str],
    page_columns: list[str],
    page_rows: list[list[Any]],
) -> list[list[Any]]:
    if not page_rows:
        return page_rows
    width = len(first_columns)
    if len(page_columns) == width:
        return page_rows

    index_map: list[int] = []
    for fc in first_columns:
        tail = _column_tail(fc)
        match = next(
            (i for i, pc in enumerate(page_columns) if _column_tail(pc) == tail),
            None,
        )
        if match is None:
            index_map = []
            break
        index_map.append(match)

    if len(index_map) == width:
        return [[row[i] for i in index_map] for row in page_rows]

    if all(len(row) >= width for row in page_rows):
        return [row[:width] for row in page_rows]

    raise RuntimeError(
        "Could not align JDBC page columns to the first page "
        f"(expected {width}, page has {len(page_columns)})."
    )


def _execute_page(
    conn: Any,
    page_sql: str,
    parameters: Sequence[Any] | None,
) -> tuple[list[str], list[list[Any]]]:
    curs = conn.cursor()
    try:
        if parameters:
            curs.execute(page_sql, parameters)
        else:
            curs.execute(page_sql)
        columns = [description[0] for description in (curs.description or [])]
        return columns, [list(row) for row in curs.fetchall()]
    finally:
        curs.close()


def _execute_page_row_count(
    conn: Any,
    page_sql: str,
    parameters: Sequence[Any] | None,
) -> int:
    """Returns the number of rows for a page without retaining cell values."""

    curs = conn.cursor()
    try:
        if parameters:
            curs.execute(page_sql, parameters)
        else:
            curs.execute(page_sql)
        return len(curs.fetchall())
    finally:
        curs.close()


def _fetch_row_count(
    conn: Any,
    base_sql: str,
    parameters: Sequence[Any] | None,
    *,
    user_limit: int | None,
    user_offset: int,
    page_size: int,
) -> int:
    """Multi-page row count for timing-only mode (no row materialization)."""

    total = 0
    offset = user_offset
    remaining = user_limit
    pages = 0
    max_pages = (
        10_000
        if user_limit is None
        else (user_limit + page_size - 1) // page_size + 2
    )

    while pages < max_pages:
        pages += 1
        if remaining is not None and remaining <= 0:
            break

        chunk_limit = page_size if remaining is None else min(page_size, remaining)
        page_sql = _page_sql(base_sql, chunk_limit, offset)
        page_count = _execute_page_row_count(conn, page_sql, parameters)

        if page_count == 0:
            break

        total += page_count

        if user_limit is not None and total >= user_limit:
            if total > user_limit:
                total = user_limit
            break

        offset += page_count
        if remaining is not None:
            remaining -= page_count

    return total


def _fetch_all_rows(
    conn: Any,
    base_sql: str,
    parameters: Sequence[Any] | None,
    *,
    user_limit: int | None,
    user_offset: int,
    page_size: int,
) -> tuple[list[str], list[list[Any]]]:
    """Transparent multi-request fetch — ServiceNow JDBC caps rows per execute."""

    columns: list[str] | None = None
    all_rows: list[list[Any]] = []
    offset = user_offset
    remaining = user_limit
    pages = 0
    max_pages = (
        10_000
        if user_limit is None
        else (user_limit + page_size - 1) // page_size + 2
    )

    while pages < max_pages:
        pages += 1
        if remaining is not None and remaining <= 0:
            break

        chunk_limit = page_size if remaining is None else min(page_size, remaining)
        page_sql = _page_sql(base_sql, chunk_limit, offset)
        page_columns, page_rows = _execute_page(conn, page_sql, parameters)

        if columns is None:
            columns = page_columns
        else:
            page_rows = _align_page_rows(columns, page_columns, page_rows)

        if not page_rows:
            break

        all_rows.extend(page_rows)

        if user_limit is not None and len(all_rows) >= user_limit:
            if len(all_rows) > user_limit:
                del all_rows[user_limit:]
            break

        offset += len(page_rows)
        if remaining is not None:
            remaining -= len(page_rows)

    return columns or [], all_rows


def run_query(
    query: str,
    parameters: Sequence[Any] | None = None,
    override: ConnectionOverride | None = None,
    *,
    timing_only: bool = False,
) -> dict[str, Any]:
    cleaned_query = _sanitize_query(query)
    if not cleaned_query:
        raise ValueError("Query is empty after stripping terminators.")

    started = time.monotonic()

    with get_connection(override) as conn:
        base_sql, user_limit, user_offset = _parse_trailing_limit_offset(cleaned_query)
        page_size = settings.sn_jdbc_page_size
        if timing_only:
            row_count = _fetch_row_count(
                conn,
                base_sql,
                parameters,
                user_limit=user_limit,
                user_offset=user_offset,
                page_size=page_size,
            )
            elapsed_ms = int((time.monotonic() - started) * 1000)
            return {
                "columns": [],
                "rows": [],
                "row_count": row_count,
                "timing_only": True,
                "duration_ms": elapsed_ms,
                "timing_note": (
                    f"Full JDBC fetch: {row_count:,} row(s); "
                    "row data not sent to the browser."
                ),
            }

        columns, rows = _fetch_all_rows(
            conn,
            base_sql,
            parameters,
            user_limit=user_limit,
            user_offset=user_offset,
            page_size=page_size,
        )

    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "timing_only": False,
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


def _coerce_optional_bool(value: Any, *, bit: bool = False) -> bool | None:
    """Maps JDBC / Java driver values to ``bool`` or ``None`` (unknown / unread).

    When ``bit`` is True, only ``0`` / ``1`` (and bool/string equivalents) count as
    boolean values; other integers return ``None``. Use for SN flags like
    ``mandatory`` so a stray numeric in the wrong slot does not become ``True``.
    """

    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        try:
            value = value.decode("utf-8")
        except Exception:
            return None
    if isinstance(value, bool):
        return value
    # ``bool`` is a subclass of ``int`` in Python; handle real ints only.
    if type(value) is int or type(value) is float:
        n = int(value)
        if bit:
            if n == 0:
                return False
            if n == 1:
                return True
            return None
        return bool(n)
    try:
        from decimal import Decimal

        if isinstance(value, Decimal):
            n = int(value)
            if bit:
                if n == 0:
                    return False
                if n == 1:
                    return True
                return None
            return bool(n)
    except ImportError:
        pass
    # JayDeBeApi often returns ``java.lang.Integer`` / ``Long`` (not ``type(...) is int``).
    if not isinstance(value, (str, bytes, bytearray)):
        try:
            n = int(value)
        except (TypeError, ValueError, OverflowError):
            pass
        else:
            if bit:
                if n == 0:
                    return False
                if n == 1:
                    return True
                return None
            if n == 0:
                return False
            if n == 1:
                return True
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
        "WHERE LOWER(child.name) = LOWER(?)",
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
) -> tuple[int, int, int] | None:
    """Maps result columns to element, internal_type, dictionary table name."""

    lowered = [str(c).lower() for c in col_names] if col_names else []

    def find_one(*aliases: str) -> int | None:
        for alias in aliases:
            for i, cn in enumerate(lowered):
                if cn == alias:
                    return i
        for alias in aliases:
            for i, cn in enumerate(lowered):
                tail = cn.rsplit(".", 1)[-1]
                if tail == alias:
                    return i
        return None

    el_i = find_one("sn_el")
    it_i = find_one("sn_it")
    nm_i = find_one("sn_nm")
    if None not in (el_i, it_i, nm_i):
        return el_i, it_i, nm_i

    el_i = find_one("element")
    it_i = find_one("internal_type")
    nm_i = find_one("dict_tab", "dict_table", "name")
    if None not in (el_i, it_i, nm_i):
        return el_i, it_i, nm_i

    if sample_row is not None and len(sample_row) >= 3:
        return 0, 1, 2
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
    """Returns ``(element, internal_type, dict_table_name)`` tuples from ``sys_dictionary``."""

    placeholders = ", ".join(["?"] * len(chain))
    primary_sql = _sanitize_query(
        "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
        "sys_dictionary.name AS sn_nm "
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
        lower_in_placeholders = ", ".join(["LOWER(?)"] * len(chain))
        lower_in_sql = _sanitize_query(
            "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
            "sys_dictionary.name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE sys_dictionary.element IS NOT NULL "
            "AND (sys_dictionary.inactive = 0 OR sys_dictionary.inactive IS NULL) "
            f"AND LOWER(sys_dictionary.name) IN ({lower_in_placeholders})",
        )
        res = _cursor_query(conn, lower_in_sql, chain)
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        plain_in_sql = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, name AS sn_nm "
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
            "sys_dictionary.name AS sn_nm "
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
            "sys_dictionary.name AS sn_nm "
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
            "SELECT element AS sn_el, internal_type AS sn_it, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            "AND (inactive = 0 OR inactive IS NULL) "
            "AND LOWER(name) = LOWER(?)",
        )
        res = _cursor_query(conn, plain_lower_sql, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        no_inactive_in_sql = _sanitize_query(
            "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
            "sys_dictionary.name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE sys_dictionary.element IS NOT NULL "
            f"AND sys_dictionary.name IN ({placeholders})",
        )
        res = _cursor_query(conn, no_inactive_in_sql, chain)
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        plain_no_inactive_in = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            f"AND name IN ({placeholders})",
        )
        res = _cursor_query(conn, plain_no_inactive_in, chain)
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        plain_lower_in = ", ".join(["LOWER(?)"] * len(chain))
        no_inactive_lower_in = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            f"AND LOWER(name) IN ({plain_lower_in})",
        )
        res = _cursor_query(conn, no_inactive_lower_in, chain)
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        no_inactive_eq = _sanitize_query(
            "SELECT sys_dictionary.element AS sn_el, sys_dictionary.internal_type AS sn_it, "
            "sys_dictionary.name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE sys_dictionary.element IS NOT NULL "
            "AND sys_dictionary.name = ?",
        )
        res = _cursor_query(conn, no_inactive_eq, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        plain_no_inactive_lower = _sanitize_query(
            "SELECT element AS sn_el, internal_type AS sn_it, name AS sn_nm "
            "FROM sys_dictionary "
            "WHERE element IS NOT NULL "
            "AND LOWER(name) = LOWER(?)",
        )
        res = _cursor_query(conn, plain_no_inactive_lower, [table.strip()])
        if res:
            col_names, raw_rows = res

    if not raw_rows:
        return []

    sample = raw_rows[0]
    idx = _dictionary_select_indices(col_names, sample)
    if idx is None:
        try:
            ncols = len(sample)
        except TypeError:
            ncols = 0
        if ncols >= 3:
            el_i, it_i, dt_i = 0, 1, 2
        else:
            return []
    else:
        el_i, it_i, dt_i = idx
    idx_max = max(el_i, it_i, dt_i)
    normalized: list[tuple[Any, ...]] = []
    for row in raw_rows:
        if len(row) <= idx_max:
            continue
        normalized.append((row[el_i], row[it_i], row[dt_i]))
    return normalized


def _wide_cursor_rows_to_dicts(
    col_names: list[str],
    raw_rows: list[Any],
) -> list[dict[str, Any]]:
    """Maps a JDBC result to canonical per-row dicts for dictionary-first listing."""

    def row_from_tails(tails: dict[str, Any]) -> dict[str, Any] | None:
        element = _coerce_optional_str(tails.get("sn_el") or tails.get("element"))
        if not element:
            return None
        return {
            "element": element,
            "dict_table": _coerce_optional_str(
                tails.get("sn_dt") or tails.get("sn_nm") or tails.get("name"),
            ),
            "internal_type": _coerce_optional_str(
                tails.get("sn_it") or tails.get("internal_type"),
            ),
            "max_length": tails.get("sn_ml") if "sn_ml" in tails else tails.get("max_length"),
            "mandatory": tails.get("sn_mq") if "sn_mq" in tails else tails.get("mandatory"),
            "read_only": tails.get("sn_ro") if "sn_ro" in tails else tails.get("read_only"),
            "reference": _coerce_optional_str(
                tails.get("sn_rf") or tails.get("reference"),
            ),
            "column_label": _coerce_optional_str(
                tails.get("sn_lb") or tails.get("column_label"),
            ),
        }

    def row_positional(row: Any) -> dict[str, Any] | None:
        """When metadata labels omit our aliases, match column order from our SELECTs."""

        if not row:
            return None
        n = len(row)
        # Wide / plain-wide: element, table, internal_type, max_length, mandatory,
        # read_only, reference, column_label
        if n >= 8:
            el = _coerce_optional_str(row[0])
            if not el:
                return None
            return {
                "element": el,
                "dict_table": _coerce_optional_str(row[1]),
                "internal_type": _coerce_optional_str(row[2]),
                "max_length": row[3],
                "mandatory": row[4],
                "read_only": row[5],
                "reference": _coerce_optional_str(row[6]),
                "column_label": _coerce_optional_str(row[7]),
            }
        # Slim: same without read_only / column_label
        if n >= 6:
            el = _coerce_optional_str(row[0])
            if not el:
                return None
            return {
                "element": el,
                "dict_table": _coerce_optional_str(row[1]),
                "internal_type": _coerce_optional_str(row[2]),
                "max_length": row[3],
                "mandatory": row[4],
                "read_only": None,
                "reference": _coerce_optional_str(row[5]),
                "column_label": None,
            }
        # Minimal: element, table name, internal_type (matches ``_load_sys_dictionary_rows`` order)
        if n >= 3:
            el = _coerce_optional_str(row[0])
            if not el:
                return None
            return {
                "element": el,
                "dict_table": _coerce_optional_str(row[1]),
                "internal_type": _coerce_optional_str(row[2]),
                "max_length": None,
                "mandatory": None,
                "read_only": None,
                "reference": None,
                "column_label": None,
            }
        return None

    out: list[dict[str, Any]] = []
    for row in raw_rows:
        if not row:
            continue
        tails: dict[str, Any] = {}
        for i, cn in enumerate(col_names):
            if i >= len(row):
                break
            tail = str(cn).lower().rsplit(".", 1)[-1]
            tails[tail] = row[i]
        mapped = row_from_tails(tails)
        if mapped is None:
            mapped = row_positional(row)
        if mapped is not None:
            out.append(mapped)
    return out


def _load_sys_dictionary_column_dicts(
    conn: Any,
    chain: list[str],
    table: str,
) -> list[dict[str, Any]]:
    """Loads ``sys_dictionary`` rows as dicts (wide projection), with SQL fallbacks."""

    placeholders = ", ".join(["?"] * len(chain))
    base_where = (
        "WHERE sys_dictionary.element IS NOT NULL "
        "AND (sys_dictionary.inactive = 0 OR sys_dictionary.inactive IS NULL) "
    )
    plain_where = (
        "WHERE element IS NOT NULL "
        "AND (inactive = 0 OR inactive IS NULL) "
    )
    wide_sel = (
        "sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
        "sys_dictionary.internal_type AS sn_it, sys_dictionary.max_length AS sn_ml, "
        "sys_dictionary.mandatory AS sn_mq, sys_dictionary.read_only AS sn_ro, "
        "sys_dictionary.reference AS sn_rf, "
        "sys_dictionary.column_label AS sn_lb "
    )
    slim_sel = (
        "sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
        "sys_dictionary.internal_type AS sn_it, sys_dictionary.max_length AS sn_ml, "
        "sys_dictionary.mandatory AS sn_mq, "
        "sys_dictionary.reference AS sn_rf "
    )
    attempts: list[tuple[str, Sequence[Any]]] = [
        (
            _sanitize_query(
                f"SELECT sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
                f"sys_dictionary.internal_type AS sn_it FROM sys_dictionary {base_where}"
                f"AND sys_dictionary.name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it "
                f"FROM sys_dictionary {plain_where}AND name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                f"SELECT {wide_sel} FROM sys_dictionary {base_where}"
                f"AND sys_dictionary.name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it, "
                "max_length AS sn_ml, mandatory AS sn_mq, read_only AS sn_ro, reference AS sn_rf, "
                "column_label AS sn_lb "
                f"FROM sys_dictionary {plain_where}AND name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                f"SELECT {slim_sel} FROM sys_dictionary {base_where}"
                f"AND sys_dictionary.name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it, "
                "max_length AS sn_ml, mandatory AS sn_mq, reference AS sn_rf "
                f"FROM sys_dictionary {plain_where}AND name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                f"SELECT sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
                f"sys_dictionary.internal_type AS sn_it FROM sys_dictionary {base_where}"
                "AND sys_dictionary.name = ?",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                f"SELECT sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
                f"sys_dictionary.internal_type AS sn_it FROM sys_dictionary {base_where}"
                "AND LOWER(sys_dictionary.name) = LOWER(?)",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it "
                f"FROM sys_dictionary {plain_where}AND LOWER(name) = LOWER(?)",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                f"SELECT {wide_sel} FROM sys_dictionary {base_where}"
                "AND sys_dictionary.name = ?",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                f"SELECT {wide_sel} FROM sys_dictionary {base_where}"
                "AND LOWER(sys_dictionary.name) = LOWER(?)",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it, "
                "max_length AS sn_ml, mandatory AS sn_mq, read_only AS sn_ro, reference AS sn_rf, "
                "column_label AS sn_lb "
                f"FROM sys_dictionary {plain_where}AND LOWER(name) = LOWER(?)",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                f"SELECT sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
                f"sys_dictionary.internal_type AS sn_it FROM sys_dictionary "
                "WHERE sys_dictionary.element IS NOT NULL "
                f"AND sys_dictionary.name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it "
                "FROM sys_dictionary WHERE element IS NOT NULL "
                f"AND name IN ({placeholders})",
            ),
            chain,
        ),
        (
            _sanitize_query(
                f"SELECT sys_dictionary.element AS sn_el, sys_dictionary.name AS sn_dt, "
                f"sys_dictionary.internal_type AS sn_it FROM sys_dictionary "
                "WHERE sys_dictionary.element IS NOT NULL "
                "AND sys_dictionary.name = ?",
            ),
            [table.strip()],
        ),
        (
            _sanitize_query(
                "SELECT element AS sn_el, name AS sn_dt, internal_type AS sn_it "
                "FROM sys_dictionary WHERE element IS NOT NULL "
                "AND LOWER(name) = LOWER(?)",
            ),
            [table.strip()],
        ),
    ]

    for sql, params in attempts:
        res = _cursor_query(conn, sql, params)
        if not res:
            continue
        col_names, raw_rows = res
        mapped = _wide_cursor_rows_to_dicts(col_names, raw_rows)
        if mapped:
            return mapped

    raw_tuples = _load_sys_dictionary_rows(conn, chain, table.strip())
    if not raw_tuples:
        return []
    out: list[dict[str, Any]] = []
    for el, it, dt in raw_tuples:
        el_s = _coerce_optional_str(el)
        if not el_s:
            continue
        out.append(
            {
                "element": el_s,
                "dict_table": _coerce_optional_str(dt),
                "internal_type": _coerce_optional_str(it),
                "max_length": None,
                "mandatory": None,
                "read_only": None,
                "reference": None,
                "column_label": None,
            },
        )
    return out


def _merge_dictionary_column_dicts(
    rows: list[dict[str, Any]],
    chain: list[str],
) -> list[dict[str, Any]]:
    """One merged row per ``element`` (inheritance: most specific ``dict_table`` first)."""

    priority = {t.lower(): i for i, t in enumerate(chain)}
    by_el: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        el = r.get("element")
        if not el:
            continue
        by_el[str(el).strip().lower()].append(r)
    merged: list[dict[str, Any]] = []
    for lk in sorted(by_el.keys(), key=lambda s: s.lower()):
        cands = by_el[lk]
        cands.sort(
            key=lambda c: priority.get(str(c.get("dict_table") or "").lower(), 999),
        )
        merged.append(dict(cands[0]))
    return merged


def _list_columns_from_sys_dictionary(
    conn: Any,
    jdbc_table: str,
) -> list[dict[str, Any]] | None:
    """Builds column metadata from ``sys_dictionary`` (inheritance chain)."""

    table_key = _dictionary_table_key(jdbc_table)
    chain = _fetch_table_chain(conn, table_key)
    if not chain:
        return None
    rows = _load_sys_dictionary_column_dicts(conn, chain, table_key)
    if not rows:
        return None
    merged = _merge_dictionary_column_dicts(rows, chain)
    merged = [
        m
        for m in merged
        if str(m.get("element") or "").strip().lower() not in JDBC_METADATA_PHANTOM_ELEMENTS
    ]
    if not merged:
        return None

    internal_types: set[str] = set()
    for m in merged:
        it = _coerce_optional_str(m.get("internal_type"))
        if it:
            internal_types.add(it)
    glide_labels = _fetch_glide_type_labels(conn, internal_types)

    api_rows: list[dict[str, Any]] = []
    for m in merged:
        el = m.get("element")
        if not el:
            continue
        name = str(el).strip()
        internal = _coerce_optional_str(m.get("internal_type"))
        glide_lab = (
            glide_labels.get(internal.lower())
            if internal
            else None
        )
        field_type = glide_lab or internal
        mand = _coerce_optional_bool(m.get("mandatory"), bit=True)
        nullable = True if mand is None else (not mand)
        type_str = field_type or internal or "string"
        api_rows.append(
            {
                "name": name,
                "type": type_str,
                "nullable": nullable,
                "internal_type": internal,
                "field_type": field_type or internal,
            },
        )
    return api_rows


# JDBC ``getColumns`` sometimes reports these as physical columns even when they
# are not dictionary-backed fields on the table (or dictionary reads fail).
JDBC_METADATA_PHANTOM_ELEMENTS = frozenset(
    {
        "sys_tags",
    },
)


def _jdbc_list_physical_columns(conn: Any, jdbc_table: str) -> list[dict[str, Any]]:
    """Last-resort column list via ``DatabaseMetaData.getColumns``.

    Used when ``sys_dictionary`` cannot be read or returns no rows (driver /
    dialect / permissions). Types come from JDBC, not Glide.
    """

    cleaned = jdbc_table.strip()
    if not cleaned:
        return []

    jconn = _java_connection(conn)
    md = jconn.getMetaData()

    variants: list[tuple[str | None, str | None, str]] = []
    if "." in cleaned:
        left, right = cleaned.rsplit(".", 1)
        left, right = left.strip(), right.strip()
        if left and right:
            variants.extend(
                [
                    (None, None, cleaned),
                    (None, left, right),
                    (None, None, right),
                ],
            )
        else:
            variants.append((None, None, cleaned))
    else:
        variants.append((None, None, cleaned))

    seen: set[tuple[str | None, str | None, str]] = set()
    ordered: list[tuple[str | None, str | None, str]] = []
    for v in variants:
        if v not in seen and v[2]:
            seen.add(v)
            ordered.append(v)

    for cat, schema, table_name in ordered:
        rs = md.getColumns(cat, schema, table_name, "%")
        rows: list[dict[str, Any]] = []
        try:
            while rs.next():
                col_name = rs.getString("COLUMN_NAME")
                if not col_name:
                    continue
                lk = str(col_name).strip().lower()
                if lk in JDBC_METADATA_PHANTOM_ELEMENTS:
                    continue
                type_name = rs.getString("TYPE_NAME")
                type_str = (type_name.strip() if type_name else "") or "string"
                try:
                    nullable_int = int(rs.getInt("NULLABLE"))
                except Exception:
                    nullable_int = 1
                rows.append(
                    {
                        "name": str(col_name).strip(),
                        "type": type_str,
                        "nullable": nullable_int == 1,
                        "internal_type": None,
                        "field_type": None,
                    },
                )
        finally:
            rs.close()
        if rows:
            return rows
    return []


def list_columns(
    table: str,
    override: ConnectionOverride | None = None,
) -> list[dict[str, Any]]:
    """Returns field metadata, preferring ``sys_dictionary`` (inheritance chain).

    When dictionary rows exist, the response matches instance field definitions
    (types, mandatory → nullable). If ``sys_dictionary`` cannot be read or
    returns no rows, falls back to JDBC ``DatabaseMetaData.getColumns`` so the
    schema UI still lists physical columns. ``JDBC_METADATA_PHANTOM_ELEMENTS``
    are dropped in both paths.
    """

    cleaned = table.strip()
    if not cleaned:
        return []

    with get_connection(override) as conn:
        dict_rows = _list_columns_from_sys_dictionary(conn, cleaned)
        if dict_rows:
            return dict_rows
        return _jdbc_list_physical_columns(conn, cleaned)
