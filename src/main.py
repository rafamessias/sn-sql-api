from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr

from src.config import settings
from src.jdbc_client import (
    ConnectionOverride,
    get_connection,
    list_columns,
    list_tables,
    run_query,
)

STATIC_DIR = Path(__file__).parent / "static"
DIST_DIR = STATIC_DIR / "dist"
DIST_INDEX = DIST_DIR / "index.html"

app = FastAPI(
    title="ServiceNow SQL API",
    description=(
        "Runs SQL against ServiceNow using the JDBC driver and URL format from "
        "https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html"
    ),
    version="1.1.0",
    docs_url="/docs",
)


class ConnectionPayload(BaseModel):
    url: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: SecretStr
    driver_class: str | None = None

    def to_override(self) -> ConnectionOverride:
        return ConnectionOverride(
            url=self.url,
            user=self.user,
            password=self.password.get_secret_value(),
            driver_class=self.driver_class,
        )


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    parameters: list[Any] | None = None
    connection: ConnectionPayload | None = None


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    row_count: int


class TablesRequest(BaseModel):
    pattern: str | None = None
    connection: ConnectionPayload | None = None


class TableInfo(BaseModel):
    name: str
    schema_name: str | None = Field(default=None, alias="schema")
    type: str | None = None

    model_config = {"populate_by_name": True}


class TablesResponse(BaseModel):
    tables: list[TableInfo]
    total: int


class ColumnsRequest(BaseModel):
    table: str = Field(min_length=1)
    connection: ConnectionPayload | None = None


class ColumnInfo(BaseModel):
    name: str
    type: str
    nullable: bool
    internal_type: str | None = None
    field_type: str | None = None
    function_field: bool | None = None


class ColumnsResponse(BaseModel):
    table: str
    columns: list[ColumnInfo]


class HealthCheckRequest(BaseModel):
    connection: ConnectionPayload | None = None


class HealthCheckResponse(BaseModel):
    status: str
    instance: str | None = None
    driver_class: str | None = None
    error: str | None = None


def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    configured_api_key = settings.api_key
    if configured_api_key is None:
        return

    if x_api_key != configured_api_key.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def _to_override(payload: ConnectionPayload | None) -> ConnectionOverride | None:
    return payload.to_override() if payload is not None else None


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "instance": settings.sn_instance,
        "jdbc_driver_class": settings.sn_jdbc_driver_class,
    }


@app.post(
    "/health/check",
    response_model=HealthCheckResponse,
    dependencies=[Depends(verify_api_key)],
)
def healthcheck_connection(
    payload: HealthCheckRequest | None = None,
) -> HealthCheckResponse:
    override = _to_override(payload.connection) if payload else None
    driver_class = (
        override.driver_class if override and override.driver_class else settings.sn_jdbc_driver_class
    )
    try:
        with get_connection(override):
            pass
    except Exception as exc:
        return HealthCheckResponse(
            status="error",
            driver_class=driver_class,
            error=f"{exc}",
        )

    if override is None:
        instance: str | None = settings.sn_instance
    else:
        instance = None

    return HealthCheckResponse(
        status="ok",
        instance=instance,
        driver_class=driver_class,
    )


@app.get("/debug/jdbc-auth", dependencies=[Depends(verify_api_key)])
def debug_jdbc_auth() -> dict[str, object]:
    return settings.jdbc_auth_debug


@app.post(
    "/query",
    response_model=QueryResponse,
    dependencies=[Depends(verify_api_key)],
)
def execute_query(payload: QueryRequest) -> QueryResponse:
    try:
        result = run_query(
            payload.query,
            payload.parameters,
            _to_override(payload.connection),
        )
        return QueryResponse(**result)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query failed: {exc}",
        ) from exc


@app.post(
    "/schema/tables",
    response_model=TablesResponse,
    dependencies=[Depends(verify_api_key)],
)
def fetch_tables(payload: TablesRequest) -> TablesResponse:
    try:
        rows = list_tables(payload.pattern, _to_override(payload.connection))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Schema discovery failed: {exc}",
        ) from exc

    tables = [
        TableInfo(name=row["name"], schema=row.get("schema"), type=row.get("type"))
        for row in rows
    ]
    return TablesResponse(tables=tables, total=len(tables))


@app.post(
    "/schema/columns",
    response_model=ColumnsResponse,
    dependencies=[Depends(verify_api_key)],
)
def fetch_columns(payload: ColumnsRequest) -> ColumnsResponse:
    try:
        rows = list_columns(payload.table, _to_override(payload.connection))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Column discovery failed: {exc}",
        ) from exc

    columns = [
        ColumnInfo(
            name=row["name"],
            type=row["type"],
            nullable=row["nullable"],
            internal_type=row.get("internal_type"),
            field_type=row.get("field_type"),
            function_field=row.get("function_field"),
        )
        for row in rows
    ]
    return ColumnsResponse(table=payload.table, columns=columns)


_DEV_FALLBACK_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>sn-sql-api · dev mode</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: #0d1117;
        color: #e6edf3;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        max-width: 560px;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 28px 32px;
      }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { color: #8b949e; line-height: 1.6; margin: 8px 0; }
      code, kbd {
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 4px;
        padding: 2px 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #e6edf3;
      }
      a { color: #3fb950; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>The web UI hasn't been built yet</h1>
      <p>
        The FastAPI service is up, but no production build was found at
        <code>src/static/dist</code>.
      </p>
      <p>For dev iteration, start the Vite dev server in another terminal:</p>
      <p>
        <code>cd web &amp;&amp; npm install &amp;&amp; npm run dev</code>
      </p>
      <p>
        Then open <a href="http://localhost:5173">http://localhost:5173</a>
        — it proxies <code>/query</code>, <code>/schema/*</code> and
        <code>/health</code> to this API.
      </p>
      <p>
        To build a production bundle into the image, run
        <code>npm run build</code> inside <code>web/</code> or rebuild with
        <code>docker compose build</code>.
      </p>
      <p>
        API docs are always available at <a href="/docs">/docs</a>.
      </p>
    </main>
  </body>
</html>
"""


if DIST_INDEX.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(DIST_DIR), html=True),
        name="web",
    )
else:

    @app.get("/", include_in_schema=False, response_class=HTMLResponse)
    def dev_placeholder() -> str:
        return _DEV_FALLBACK_HTML
