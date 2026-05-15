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
    timeout_s: float = 120.0,
) -> dict[str, Any]:
    """GET ``/api/now/table/{table}`` — see ServiceNow Table API reference."""

    table_clean = _validate_table_name(table)
    origin, user, password = _resolve_origin_user_password(override)

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

    path_table = quote(table_clean, safe="")
    query = urlencode(params, doseq=True)
    full_path = f"/api/now/table/{path_table}"
    url = f"{origin.rstrip('/')}{full_path}" + (f"?{query}" if query else "")

    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    req = Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {token}",
        },
    )

    started = time.monotonic()
    total_header: str | None = None
    try:
        with urlopen(req, timeout=timeout_s) as resp:
            total_header = resp.headers.get("X-Total-Count")
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        detail = exc.read().decode("utf-8", errors="replace")
        message = f"HTTP {exc.code}"
        try:
            payload = json.loads(detail)
            err = payload.get("error")
            if isinstance(err, dict) and err.get("message"):
                message = f"{message}: {err['message']}"
            elif isinstance(err, str):
                message = f"{message}: {err}"
        except json.JSONDecodeError:
            if detail.strip():
                message = f"{message}: {detail.strip()[:500]}"
        raise ValueError(message) from exc
    except URLError as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        raise ValueError(f"Network error calling Table API: {exc}") from exc

    elapsed_ms = int((time.monotonic() - started) * 1000)

    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Table API returned non-JSON body.") from exc

    result_list = body.get("result")
    if not isinstance(result_list, list):
        raise ValueError("Table API JSON missing a `result` array.")

    records = [r for r in result_list if isinstance(r, dict)]
    columns, rows = _rows_to_grid(records)

    total_count: int | None = None
    if total_header is not None and str(total_header).strip().isdigit():
        total_count = int(str(total_header).strip())

    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "total_count": total_count,
        "duration_ms": elapsed_ms,
        "request_path": full_path + ("?" + query if query else ""),
    }
