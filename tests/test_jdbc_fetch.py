from src.jdbc_client import (
    _align_page_rows,
    _page_sql,
    _parse_trailing_limit_offset,
)


def test_parse_limit_offset() -> None:
    base, limit, offset = _parse_trailing_limit_offset(
        "SELECT 1 FROM incident WHERE active = 1 LIMIT 50000",
    )
    assert "LIMIT" not in base
    assert limit == 50000
    assert offset == 0


def test_page_sql_wraps_subquery() -> None:
    sql = _page_sql("SELECT a FROM t", 10_000, 20_000)
    assert "sn_sql_api_page" in sql
    assert sql.endswith("LIMIT 10000 OFFSET 20000")


def test_align_extra_columns() -> None:
    first = ["number", "short_description", "sys_created_on", "sys_created_by"]
    page_cols = [
        "incident.number",
        "incident.short_description",
        "incident.sys_created_on",
        "incident.sys_created_by",
        "sys_id",
        "sys_class_name",
        "sys_created_on",
        "sys_updated_on",
    ]
    rows = [[f"c{j}" for j in range(8)]]
    aligned = _align_page_rows(first, page_cols, rows)
    assert len(aligned[0]) == 4
    assert aligned[0][0] == "c0"
