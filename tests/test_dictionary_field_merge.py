"""Tests for ``sys_dictionary`` merge (inheritance chain ordering)."""

from __future__ import annotations

from src.jdbc_client import _merge_dictionary_column_dicts, _wide_cursor_rows_to_dicts


def test_merge_most_specific_dict_table_row_wins() -> None:
    rows = [
        {
            "element": "priority",
            "dict_table": "task",
            "internal_type": "integer",
            "mandatory": 0,
            "max_length": None,
            "read_only": None,
            "reference": None,
            "column_label": None,
        },
        {
            "element": "priority",
            "dict_table": "incident",
            "internal_type": "integer",
            "mandatory": 1,
            "max_length": None,
            "read_only": None,
            "reference": None,
            "column_label": None,
        },
    ]
    chain = ["incident", "task"]
    merged = _merge_dictionary_column_dicts(rows, chain)
    assert len(merged) == 1
    assert merged[0]["dict_table"] == "incident"
    assert merged[0]["mandatory"] == 1


def test_wide_rows_map_without_column_metadata_labels() -> None:
    """Simba / native drivers sometimes omit usable ``cursor.description`` labels."""

    rows = [("number", "incident", "string")]
    mapped = _wide_cursor_rows_to_dicts([], rows)
    assert len(mapped) == 1
    assert mapped[0]["element"] == "number"
    assert mapped[0]["dict_table"] == "incident"
    assert mapped[0]["internal_type"] == "string"


def test_merge_single_row_per_element() -> None:
    rows = [
        {
            "element": "number",
            "dict_table": "incident",
            "internal_type": "string",
            "mandatory": 1,
            "max_length": 40,
            "read_only": None,
            "reference": None,
            "column_label": "Number",
        },
    ]
    merged = _merge_dictionary_column_dicts(rows, ["incident"])
    assert len(merged) == 1
    assert merged[0]["element"] == "number"
    assert merged[0]["column_label"] == "Number"
