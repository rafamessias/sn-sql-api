from typing import Any
from unittest.mock import patch

from src.table_api_client import _fetch_table_api_timing_full


def _fake_page(
    *,
    origin: str,
    user: str,
    password: str,
    table_clean: str,
    params: dict[str, str],
    timeout_s: float,
) -> tuple[list[dict[str, Any]], int | None, str]:
    limit = int(params["sysparm_limit"])
    offset = int(params.get("sysparm_offset", "0"))
    if offset == 0:
        records = [{"sys_id": str(i)} for i in range(limit)]
        return records, 99_999, "/api/now/table/incident?offset=0"
    remaining = 15_000 - offset
    n = min(limit, remaining)
    records = [{"sys_id": str(i)} for i in range(n)]
    return records, 99_999, "/api/now/table/incident?offset=10000"


def test_timing_full_fetch_paginates_until_limit() -> None:
    with patch(
        "src.table_api_client._table_api_get_page",
        side_effect=_fake_page,
    ):
        out = _fetch_table_api_timing_full(
            table_clean="incident",
            origin="https://example.service-now.com",
            user="u",
            password="p",
            sysparm_query=None,
            sysparm_fields="sys_id",
            sysparm_limit=15_000,
            sysparm_offset=0,
            sysparm_display_value=None,
            sysparm_exclude_reference_link=None,
            sysparm_view=None,
            sysparm_query_no_domain=None,
            sysparm_suppress_pagination_header=True,
            timeout_s=30.0,
        )

    assert out["row_count"] == 15_000
    assert out["timing_only"] is True
    assert "2 request(s)" in out["timing_note"]
