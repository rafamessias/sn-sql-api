from unittest.mock import MagicMock, patch

from src.jdbc_client import run_query


def test_run_query_timing_only_counts_without_materializing_rows() -> None:
    mock_conn = MagicMock()
    with (
        patch("src.jdbc_client.get_connection") as mock_get_conn,
        patch("src.jdbc_client._fetch_row_count", return_value=12_345) as mock_count,
        patch("src.jdbc_client._fetch_all_rows") as mock_fetch,
    ):
        mock_get_conn.return_value.__enter__.return_value = mock_conn
        result = run_query(
            "SELECT number FROM incident LIMIT 12345",
            timing_only=True,
        )

    mock_count.assert_called_once()
    mock_fetch.assert_not_called()
    assert result["timing_only"] is True
    assert result["row_count"] == 12_345
    assert result["rows"] == []
    assert result["columns"] == []
