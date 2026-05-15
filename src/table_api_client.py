"""ServiceNow Table API (GET) using the same credentials as JDBC."""

from __future__ import annotations

import base64
import json
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from src.config import settings
from src.jdbc_client import ConnectionOverride
from src.rest_base_url import jdbc_url_to_https_origin

_TABLE_SEGMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# ServiceNow Table API documented default maximum rows per GET.
_TABLE_API_MAX_PAGE = 10_000
_TABLE_API_TIMING_MAX_REQUESTS = 1_000


def _default_https_origin() -> str:
    return f"https://{settings.normalized_instance}"


def _resolve_origin_user_password(override: ConnectionOverride | None) -> tuple[str, str, str]:
    if override is None:
        return (
            _default_https_origin(),
            settings.sn_username,
            settings.sn_password.get_secret_value(),
        )
    return (
        jdbc_url_to_https_origin(override.url),
        override.user.strip(),
        override.password,
    )


def _validate_table_name(table: str) -> str:
    name = table.strip()
    if not name or not _TABLE_SEGMENT_RE.match(name):
        raise ValueError(
            "Invalid table name: use the API name (letters, digits, underscore), "
            "for example `incident` or `sys_user`.",
        )
    return name


def _flatten_record(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, (dict, list)):
            out[key] = json.dumps(value, separators=(",", ":"), default=str)
        else:
            out[key] = value
    return out


def _format_table_api_http_error(code: int, body: str) -> str:
    """Turn a ServiceNow Table API error JSON body into a readable message."""
    head = f"HTTP {code}"
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        stripped = body.strip()
        return f"{head}: {stripped[:500]}" if stripped else head

    err = payload.get("error")
    if not isinstance(err, dict):
        stripped = body.strip()
        return f"{head}: {stripped[:500]}" if stripped else head

    message = err.get("message")
    detail = err.get("detail")
    if message:
        head = f"{head}: {message}"
    if isinstance(detail, str):
        detail_text = detail.strip()
        if detail_text and (
            not isinstance(message, str)
            or detail_text.lower() != message.strip().lower()
        ):
            head = f"{head} — {detail_text}"
    return head


def _timing_page_limit(remaining: int | None) -> int:
    if remaining is None:
        return _TABLE_API_MAX_PAGE
    return min(remaining, _TABLE_API_MAX_PAGE)


def _timing_only_note(
    *,
    row_count: int,
    request_count: int,
    total_count: int | None,
) -> str:
    base = (
        f"Full Table API fetch: {row_count:,} row(s) across {request_count} "
        "request(s); row data not sent to the browser."
    )
    if total_count is not None and total_count != row_count:
        return f"{base} X-Total-Count {total_count:,} matches the filter."
    return base


def _rows_to_grid(records: list[dict[str, Any]]) -> tuple[list[str], list[list[Any]]]:
    if not records:
        return [], []
    columns: list[str] = []
    seen: set[str] = set()
    for rec in records:
        for key in rec:
            if key not in seen:
                seen.add(key)
                columns.append(key)
    rows: list[list[Any]] = []
    for rec in records:
        flat = _flatten_record(rec)
        rows.append([flat.get(col) for col in columns])
    return columns, rows


def _build_table_api_params(
    *,
    sysparm_query: str | None,
    sysparm_fields: str | None,
    sysparm_limit: int | None,
    sysparm_offset: int | None,
    sysparm_display_value: str | None,
    sysparm_exclude_reference_link: bool | None,
    sysparm_view: str | None,
    sysparm_query_no_domain: bool | None,
    sysparm_suppress_pagination_header: bool | None,
) -> dict[str, str]:
    params: dict[str, str] = {}
    if sysparm_query is not None and sysparm_query.strip():
        params["sysparm_query"] = sysparm_query.strip()
    if sysparm_fields is not None and sysparm_fields.strip():
        params["sysparm_fields"] = sysparm_fields.strip()
    if sysparm_limit is not None:
        params["sysparm_limit"] = str(sysparm_limit)
    if sysparm_offset is not None:
        params["sysparm_offset"] = str(sysparm_offset)
    if sysparm_display_value is not None and sysparm_display_value.strip():
        v = sysparm_display_value.strip().lower()
        if v not in {"true", "false", "all"}:
            raise ValueError("sysparm_display_value must be true, false, or all.")
        params["sysparm_display_value"] = v
    if sysparm_exclude_reference_link is not None:
        params["sysparm_exclude_reference_link"] = (
            "true" if sysparm_exclude_reference_link else "false"
        )
    if sysparm_view is not None and sysparm_view.strip():
        params["sysparm_view"] = sysparm_view.strip()
    if sysparm_query_no_domain is not None:
        params["sysparm_query_no_domain"] = "true" if sysparm_query_no_domain else "false"
    if sysparm_suppress_pagination_header is not None:
        params["sysparm_suppress_pagination_header"] = (
            "true" if sysparm_suppress_pagination_header else "false"
        )
    return params


def _table_api_get_page(
    *,
    origin: str,
    user: str,
    password: str,
    table_clean: str,
    params: dict[str, str],
    timeout_s: float,
) -> tuple[list[dict[str, Any]], int | None, str]:
    """One Table API GET. Returns ``(records, total_count, request_path_with_query)``."""

    path_table = quote(table_clean, safe="")
    query = urlencode(params, doseq=True)
    full_path = f"/api/now/table/{path_table}"
    request_path = full_path + (f"?{query}" if query else "")
    url = f"{origin.rstrip('/')}{request_path}"

    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    req = Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {token}",
        },
    )

    try:
        with urlopen(req, timeout=timeout_s) as resp:
            total_header = resp.headers.get("X-Total-Count")
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(_format_table_api_http_error(exc.code, detail)) from exc
    except URLError as exc:
        raise ValueError(f"Network error calling Table API: {exc}") from exc

    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Table API returned non-JSON body.") from exc

    result_list = body.get("result")
    if not isinstance(result_list, list):
        raise ValueError("Table API JSON missing a `result` array.")

    records = [r for r in result_list if isinstance(r, dict)]

    total_count: int | None = None
    if total_header is not None and str(total_header).strip().isdigit():
        total_count = int(str(total_header).strip())

    return records, total_count, request_path


def _fetch_table_api_timing_full(
    *,
    table_clean: str,
    origin: str,
    user: str,
    password: str,
    sysparm_query: str | None,
    sysparm_fields: str | None,
    sysparm_limit: int | None,
    sysparm_offset: int | None,
    sysparm_display_value: str | None,
    sysparm_exclude_reference_link: bool | None,
    sysparm_view: str | None,
    sysparm_query_no_domain: bool | None,
    sysparm_suppress_pagination_header: bool | None,
    timeout_s: float,
) -> dict[str, Any]:
    """Full Table API fetch with the caller's sysparms; rows are counted but not returned."""

    started = time.monotonic()
    base_offset = sysparm_offset if sysparm_offset is not None else 0
    remaining = sysparm_limit
    offset = base_offset
    fetched = 0
    request_count = 0
    total_count: int | None = None
    last_request_path = f"/api/now/table/{quote(table_clean, safe='')}"

    while request_count < _TABLE_API_TIMING_MAX_REQUESTS:
        if remaining is not None and remaining <= 0:
            break

        chunk_limit = _timing_page_limit(remaining)
        page_params = _build_table_api_params(
            sysparm_query=sysparm_query,
            sysparm_fields=sysparm_fields,
            sysparm_limit=chunk_limit,
            sysparm_offset=offset,
            sysparm_display_value=sysparm_display_value,
            sysparm_exclude_reference_link=sysparm_exclude_reference_link,
            sysparm_view=sysparm_view,
            sysparm_query_no_domain=sysparm_query_no_domain,
            sysparm_suppress_pagination_header=sysparm_suppress_pagination_header,
        )

        records, page_total, last_request_path = _table_api_get_page(
            origin=origin,
            user=user,
            password=password,
            table_clean=table_clean,
            params=page_params,
            timeout_s=timeout_s,
        )
        request_count += 1
        if page_total is not None:
            total_count = page_total

        if not records:
            break

        fetched += len(records)
        if len(records) < chunk_limit:
            break

        if remaining is not None:
            remaining -= len(records)
            if remaining <= 0:
                break

        offset += len(records)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return {
        "columns": [],
        "rows": [],
        "row_count": fetched,
        "total_count": total_count,
        "duration_ms": elapsed_ms,
        "request_path": last_request_path,
        "timing_only": True,
        "timing_note": _timing_only_note(
            row_count=fetched,
            request_count=request_count,
            total_count=total_count,
        ),
    }


def fetch_table_api_records(
    *,
    table: str,
    override: ConnectionOverride | None,
    sysparm_query: str | None = None,
    sysparm_fields: str | None = None,
    sysparm_limit: int | None = None,
    sysparm_offset: int | None = None,
    sysparm_display_value: str | None = None,
    sysparm_exclude_reference_link: bool | None = None,
    sysparm_view: str | None = None,
    sysparm_query_no_domain: bool | None = None,
    sysparm_suppress_pagination_header: bool | None = None,
    timing_only: bool = False,
    timeout_s: float = 120.0,
) -> dict[str, Any]:
    """GET ``/api/now/table/{table}`` — see ServiceNow Table API reference."""

    table_clean = _validate_table_name(table)
    origin, user, password = _resolve_origin_user_password(override)

    if timing_only:
        return _fetch_table_api_timing_full(
            table_clean=table_clean,
            origin=origin,
            user=user,
            password=password,
            sysparm_query=sysparm_query,
            sysparm_fields=sysparm_fields,
            sysparm_limit=sysparm_limit,
            sysparm_offset=sysparm_offset,
            sysparm_display_value=sysparm_display_value,
            sysparm_exclude_reference_link=sysparm_exclude_reference_link,
            sysparm_view=sysparm_view,
            sysparm_query_no_domain=sysparm_query_no_domain,
            sysparm_suppress_pagination_header=sysparm_suppress_pagination_header,
            timeout_s=timeout_s,
        )

    params = _build_table_api_params(
        sysparm_query=sysparm_query,
        sysparm_fields=sysparm_fields,
        sysparm_limit=sysparm_limit,
        sysparm_offset=sysparm_offset,
        sysparm_display_value=sysparm_display_value,
        sysparm_exclude_reference_link=sysparm_exclude_reference_link,
        sysparm_view=sysparm_view,
        sysparm_query_no_domain=sysparm_query_no_domain,
        sysparm_suppress_pagination_header=sysparm_suppress_pagination_header,
    )

    started = time.monotonic()
    records, total_count, request_path = _table_api_get_page(
        origin=origin,
        user=user,
        password=password,
        table_clean=table_clean,
        params=params,
        timeout_s=timeout_s,
    )
    elapsed_ms = int((time.monotonic() - started) * 1000)

    columns, rows = _rows_to_grid(records)

    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "total_count": total_count,
        "duration_ms": elapsed_ms,
        "request_path": request_path,
        "timing_only": False,
    }
