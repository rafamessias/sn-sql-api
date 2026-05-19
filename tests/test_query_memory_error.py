from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_query_memory_error_returns_503(client: TestClient) -> None:
    with patch(
        "src.main.run_query",
        side_effect=MemoryError("simulate OOM"),
    ):
        response = client.post(
            "/query",
            json={"query": "SELECT 1 FROM incident LIMIT 1"},
        )

    assert response.status_code == 503
    assert "memory" in response.json()["detail"].lower()
