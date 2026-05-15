from src.table_api_client import _timing_only_note, _timing_page_limit


def test_timing_page_limit_caps_at_platform_max() -> None:
    assert _timing_page_limit(25_000) == 10_000
    assert _timing_page_limit(None) == 10_000
    assert _timing_page_limit(50) == 50


def test_timing_only_note_full_fetch() -> None:
    note = _timing_only_note(
        row_count=10_000,
        request_count=1,
        total_count=755_430,
    )
    assert "Full Table API fetch" in note
    assert "10,000 row(s)" in note
    assert "not sent to the browser" in note
    assert "755,430" in note


def test_timing_only_note_without_total_mismatch() -> None:
    note = _timing_only_note(
        row_count=100,
        request_count=1,
        total_count=100,
    )
    assert "X-Total-Count" not in note
