import hashlib
import json
import logging
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse, Response
from starlette.types import Scope

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

# Paths that load the SPA shell (see `web/src/hooks/use-console-tab.ts`); everything else gets `404.html`.
_SPA_SHELL_SEGMENTS = frozenset({"editor", "schema", "connections", "logs"})


def _spa_serves_index_html(path: str) -> bool:
    """Whether a missing static path should receive `index.html` (tab deep links) vs the HTML 404 page."""
    if path == "index.html":
        return True
    trimmed = path.strip("/")
    if not trimmed:
        return True
    if "/" in trimmed:
        return False
    return trimmed in _SPA_SHELL_SEGMENTS


class _SpaStaticFiles(StaticFiles):
    """`StaticFiles(html=True)` does not fall back to `index.html` for client-only paths (e.g. `/editor`).

    Starlette only auto-serves `index.html` for **directory** URLs and optional `404.html`; missing
    files otherwise return 404, which FastAPI surfaces as JSON — breaking SPA deep links on reload.

    Unknown non-asset paths return the bundled `404.html` with status 404 when present.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not self.html:
                raise
            # Real missing bundles should stay 404 (avoid masking typos / stale deploys).
            if path == "assets" or path.startswith("assets/"):
                raise
            if _spa_serves_index_html(path):
                return await super().get_response("index.html", scope)
            dist_404 = Path(self.directory) / "404.html"
            if dist_404.is_file():
                return FileResponse(dist_404, status_code=404)
            return await super().get_response("index.html", scope)


_DIST_INDEX_MODULE_SCRIPT = re.compile(
    r"""<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']""",
    re.IGNORECASE,
)


def _app_src_bind_mount_source() -> str | None:
    """If present, `/app/src` is a bind mount (e.g. dev compose) and replaces image `static/dist`."""
    try:
        raw = Path("/proc/mounts").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[1] == "/app/src":
            return parts[0]
    return None


def _ui_serving_probe() -> dict[str, object]:
    """Facts about which bundled UI files this process is using (for Docker / path debugging)."""
    stamp_path = DIST_DIR / "ui-image-build.txt"
    stamp: str | None = None
    if stamp_path.is_file():
        stamp = stamp_path.read_text(encoding="utf-8", errors="replace").strip()

    index_sha256: str | None = None
    module_script_src: str | None = None
    if DIST_INDEX.is_file():
        raw_index = DIST_INDEX.read_bytes()
        index_sha256 = hashlib.sha256(raw_index).hexdigest()
        text = raw_index.decode("utf-8", errors="replace")
        m = _DIST_INDEX_MODULE_SCRIPT.search(text)
        if m:
            module_script_src = m.group(1)

    assets_dir = DIST_DIR / "assets"
    js_assets: list[str] = []
    if assets_dir.is_dir():
        js_assets = sorted(p.name for p in assets_dir.glob("*.js"))[:12]

    return {
        "dist_dir": str(DIST_DIR.resolve()),
        "index_html_present": DIST_INDEX.is_file(),
        "index_html_sha256": index_sha256,
        "vite_module_script_src": module_script_src,
        "ui_image_build_stamp": stamp,
        "js_asset_filenames": js_assets,
        "app_src_bind_mount": _app_src_bind_mount_source(),
    }


def _log_bundled_ui_serving() -> None:
    log = logging.getLogger("uvicorn.error")
    probe = _ui_serving_probe()
    log.info("sn-sql-api bundled UI probe: %s", json.dumps(probe, default=str))


class _LocalhostBindFilter(logging.Filter):
    """Rewrite uvicorn's startup line so it shows localhost instead of 0.0.0.0.

    Uvicorn binds to 0.0.0.0 to accept connections on every interface (which
    is exactly what we want inside a container), but the raw bind address is
    confusing in logs — the URL users can actually click from the host is
    http://localhost:<port>. This filter only rewrites the printed message;
    the bind address is unchanged.
    """

    _NEEDLE = "://0.0.0.0:"
    _REPL = "://localhost:"

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if self._NEEDLE not in message:
            return True
        # Pre-format the message so the rewrite is reliable regardless of how
        # uvicorn passed the args (it logs via "%s" substitution).
        record.msg = message.replace(self._NEEDLE, self._REPL)
        record.args = None
        return True


logging.getLogger("uvicorn.error").addFilter(_LocalhostBindFilter())

app = FastAPI(
    title="ServiceNow SQL API",
    description=(
        "Runs SQL against ServiceNow using the JDBC driver and URL format from "
        "https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html\n\n"
        "Made by Rafael Messias — https://www.linkedin.com/in/rafaelmessias/\n"
        "Licensed under MIT. See `GET /about` for full credits."
    ),
    version="1.1.0",
    docs_url="/docs",
    contact={
        "name": "Rafael Messias",
        "url": "https://www.linkedin.com/in/rafaelmessias/",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
)


@app.middleware("http")
async def _no_store_for_bundled_ui(request: Request, call_next):
    """Browsers often cache `/` and `/assets/*` aggressively; stale shells look like 'old Docker'."""
    response = await call_next(request)
    path = request.url.path
    if (
        path == "/"
        or path == "/index.html"
        or path == "/ui-image-build.txt"
        or path == "/favicon.ico"
        or path.startswith("/assets/")
    ):
        response.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


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


class EgressIpResponse(BaseModel):
    """Public address used for outbound HTTPS from this API process (typical JDBC egress)."""

    ip: str | None = None
    error: str | None = None


class AboutResponse(BaseModel):
    """Authorship and license metadata — the hidden /about easter egg."""

    author: str
    linkedin: str | None = None
    repository: str | None = None
    license: str
    license_summary: str
    disclaimer: str
    tagline: str
    banner: str


_EGRESS_PROBE_URL = "https://api.ipify.org?format=json"
_EGRESS_PROBE_TIMEOUT_S = 8.0


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


_ABOUT_INFO = AboutResponse(
    author="Rafael Messias",
    linkedin="https://www.linkedin.com/in/rafaelmessias/",
    repository="https://github.com/rafamessias/sn-sql-api",
    license="MIT",
    license_summary=(
        "Released under the MIT License. You are free to use, copy, modify, "
        "merge, publish, distribute, sublicense, and/or sell copies of this "
        "software, as long as the copyright notice is preserved. Provided "
        '"AS IS", without warranty of any kind.'
    ),
    disclaimer=(
        "The author assumes no responsibility for how this software is used. "
        "You alone are accountable for your deployments, queries, data "
        "handling, and any downstream consequences."
    ),
    tagline=(
        "Crafted with caffeine, JDBC and questionable amounts of curl by "
        "Rafael Messias."
    ),
    banner="↓ ↘ → + A = Hadouken!🔥.. yes, you've just found an easter egg.",
)


_HADOUKEN_STYLES = """
      .hadouken-overlay[hidden] { display: none; }
      .hadouken-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(13, 17, 23, 0.95);
        backdrop-filter: blur(8px);
        padding: 24px;
      }
      .hadouken-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 640px;
        width: 100%;
      }
      .hadouken-fire {
        font-size: 72px;
        line-height: 1;
        animation: hadouken-bounce 0.6s infinite;
      }
      .hadouken-title {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 96px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        color: #3fb950;
        margin: 16px 0 0;
        text-shadow: 0 0 24px rgba(63, 185, 80, 0.5);
        animation: hadouken-shake 220ms ease-in-out infinite;
      }
      .hadouken-moves {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 14px;
        letter-spacing: 0.4em;
        color: #8b949e;
        margin: 24px 0 8px;
        text-transform: uppercase;
      }
      .hadouken-hint {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #6e7681;
      }
      .hadouken-hint strong {
        color: #3fb950;
        font-weight: 600;
      }
      .hadouken-progress {
        margin-top: 32px;
        width: 100%;
        height: 4px;
        background: #21262d;
        border-radius: 999px;
        overflow: hidden;
      }
      .hadouken-progress > div {
        height: 100%;
        background: #3fb950;
        width: 100%;
        transition: width 100ms linear;
      }
      @keyframes hadouken-bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      @keyframes hadouken-shake {
        0%, 100% { transform: translate(0, 0); }
        25% { transform: translate(-2px, 1px); }
        50% { transform: translate(2px, -1px); }
        75% { transform: translate(-1px, 2px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .hadouken-title, .hadouken-fire { animation: none; }
      }
      @media (max-width: 640px) {
        .hadouken-title { font-size: 56px; }
        .hadouken-fire { font-size: 56px; }
      }
"""


_HADOUKEN_HTML = """
    <div
      class="hadouken-overlay"
      id="hadouken-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hadouken-title"
      hidden
    >
      <div class="hadouken-card">
        <div class="hadouken-fire" aria-hidden="true">🔥</div>
        <h2 class="hadouken-title" id="hadouken-title">Hadouken!</h2>
        <p class="hadouken-moves">↓ &nbsp; ↘ &nbsp; → &nbsp; + &nbsp; A</p>
        <p class="hadouken-hint">
          auto-closing in <strong id="hadouken-countdown">10</strong>s ·
          press <kbd>Esc</kbd> to dismiss
        </p>
        <div class="hadouken-progress"><div id="hadouken-bar"></div></div>
      </div>
    </div>
"""


_HADOUKEN_SCRIPT = """
    <script>
      (function () {
        var overlay = document.getElementById('hadouken-overlay');
        var bar = document.getElementById('hadouken-bar');
        var countdown = document.getElementById('hadouken-countdown');
        if (!overlay || !bar || !countdown) return;

        var RECENT_MS = 800;
        var AUTO_CLOSE_MS = 10000;
        var TICK_MS = 100;

        var lastSeen = { down: 0, right: 0 };
        var heldAt = { down: 0, right: 0 };
        var intervalId = null;

        function isRecent(t, now) {
          return t > 0 && now - t <= RECENT_MS;
        }

        function openModal() {
          overlay.hidden = false;
          overlay.removeAttribute('hidden');
          var startedAt = Date.now();

          function tick() {
            var elapsed = Date.now() - startedAt;
            var remaining = Math.max(0, AUTO_CLOSE_MS - elapsed);
            var progress = (remaining / AUTO_CLOSE_MS) * 100;
            bar.style.width = progress + '%';
            countdown.textContent = Math.ceil(remaining / 1000);
            if (remaining === 0) closeModal();
          }

          if (intervalId) clearInterval(intervalId);
          tick();
          intervalId = setInterval(tick, TICK_MS);
        }

        function closeModal() {
          overlay.hidden = true;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }

        document.addEventListener('keydown', function (event) {
          if (event.ctrlKey || event.metaKey || event.altKey) return;

          if (!overlay.hidden && event.key === 'Escape') {
            closeModal();
            return;
          }

          var key = event.key ? event.key.toLowerCase() : '';
          var now = Date.now();

          if (key === 'arrowdown') {
            if (heldAt.down === 0) heldAt.down = now;
            lastSeen.down = now;
            return;
          }
          if (key === 'arrowright') {
            if (heldAt.right === 0) heldAt.right = now;
            lastSeen.right = now;
            return;
          }
          if (key !== 'a' || event.repeat) return;

          var downReady = heldAt.down > 0 || isRecent(lastSeen.down, now);
          var rightReady = heldAt.right > 0 || isRecent(lastSeen.right, now);
          var stillHeld = heldAt.down > 0 || heldAt.right > 0;

          if (downReady && rightReady && stillHeld) {
            lastSeen.down = 0;
            lastSeen.right = 0;
            openModal();
          }
        }, true);

        document.addEventListener('keyup', function (event) {
          var key = event.key ? event.key.toLowerCase() : '';
          if (key === 'arrowdown') heldAt.down = 0;
          else if (key === 'arrowright') heldAt.right = 0;
        }, true);

        window.addEventListener('blur', function () {
          heldAt.down = 0;
          heldAt.right = 0;
        });

        overlay.addEventListener('click', function (event) {
          if (event.target === overlay) closeModal();
        });
      })();
    </script>
"""


def _render_about_html(info: AboutResponse) -> str:
    linkedin = info.linkedin or ""
    repository = info.repository or ""
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>sn-sql-api · credits</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root {{ color-scheme: dark; }}
      body {{
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: #0d1117;
        color: #e6edf3;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }}
      .card {{
        max-width: 560px;
        width: 100%;
        background: #161b22;
        border: 1px solid #3fb950;
        border-radius: 12px;
        padding: 28px 32px;
        box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.15);
      }}
      .eyebrow {{
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #3fb950;
        margin: 0 0 6px;
      }}
      h1 {{ margin: 0 0 16px; font-size: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
      p {{ color: #8b949e; line-height: 1.6; margin: 8px 0; font-size: 13px; }}
      dl {{ margin: 12px 0; display: grid; grid-template-columns: 80px 1fr; gap: 8px 12px; font-size: 13px; }}
      dt {{ color: #6e7681; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
      dd {{ margin: 0; color: #e6edf3; }}
      a:not(.btn-back) {{ color: #3fb950; text-decoration: none; }}
      a:not(.btn-back):hover {{ text-decoration: underline; }}
      .btn-back {{
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-top: 18px;
        padding: 0.65rem 1rem;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.9rem;
        text-decoration: none;
        color: #3fb950;
        background: #1a4422;
        border: 1px solid rgba(63, 185, 80, 0.35);
        transition: background 0.15s ease, border-color 0.15s ease;
      }}
      .btn-back:hover {{
        background: rgba(63, 185, 80, 0.22);
        border-color: rgba(63, 185, 80, 0.55);
        text-decoration: none;
      }}
      .btn-back:focus-visible {{
        outline: none;
        box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.25);
      }}
      .egg-wrap {{
        display: flex;
        justify-content: flex-end;
        margin-top: 10px;
      }}
      .egg-reveal {{
        display: inline-flex;
        flex-direction: row-reverse;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px 10px;
        max-width: 100%;
      }}
      .egg-reveal > summary {{
        list-style: none;
        cursor: pointer;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        display: grid;
        place-items: center;
        border-radius: 8px;
        border: 1px solid transparent;
        font-size: 15px;
        line-height: 1;
        opacity: 0.28;
        transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        user-select: none;
      }}
      .egg-reveal > summary::-webkit-details-marker {{
        display: none;
      }}
      .egg-reveal > summary:hover,
      .egg-reveal > summary:focus-visible {{
        opacity: 0.95;
        border-color: #30363d;
        background: #0d1117;
        outline: none;
      }}
      .egg-reveal[open] > summary {{
        opacity: 1;
        border-color: #3fb950;
        background: rgba(63, 185, 80, 0.08);
      }}
      .egg-body {{
        margin: 0;
        padding: 6px 10px;
        border: 1px solid #30363d;
        border-radius: 6px;
        text-align: right;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: #3fb950;
        font-size: 12px;
        line-height: 1.35;
        background: #0d1117;
        min-width: 0;
        flex: 1 1 auto;
      }}
      .disclaimer {{
        margin-top: 14px;
        padding: 10px 12px;
        border: 1px solid #e3b341;
        border-left-width: 3px;
        border-radius: 6px;
        color: #e3b341;
        font-size: 12px;
        line-height: 1.5;
        background: rgba(227, 179, 65, 0.06);
      }}
      .disclaimer strong {{
        display: block;
        margin-bottom: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }}
      .footer {{ margin-top: 18px; font-size: 11px; color: #6e7681; }}
      kbd {{
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 4px;
        padding: 1px 5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        color: #e6edf3;
      }}
{_HADOUKEN_STYLES}
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">// credits</p>
      <h1>sn-sql-api</h1>
      <p>{info.tagline}</p>
      <dl>
        <dt>author</dt>
        <dd><a href="{linkedin}" target="_blank" rel="noopener noreferrer">{info.author}</a></dd>
        <dt>license</dt>
        <dd>{info.license}</dd>
        <dt>source</dt>
        <dd><a href="{repository}" target="_blank" rel="noopener noreferrer">{repository}</a></dd>
      </dl>
      <p>{info.license_summary}</p>
      <div class="disclaimer">
        <strong>Disclaimer</strong>
        {info.disclaimer}
      </div>
      <div class="egg-wrap">
        <details class="egg-reveal">
          <summary class="egg-trigger" title="Nothing to see here…" aria-label="Reveal a tiny secret">
            🔥
          </summary>
          <div class="egg-body">{info.banner}</div>
        </details>
      </div>
      <a class="btn-back" href="/">Back to the SQL console</a>
      <p class="footer">
        Prefer JSON? <a href="/about?format=json">/about?format=json</a>
        — or <code>curl -H 'Accept: application/json' /about</code>.
      </p>
    </main>
{_HADOUKEN_HTML}
{_HADOUKEN_SCRIPT}
  </body>
</html>
"""


def _wants_html(request: Request, format_param: str | None) -> bool:
    """Browsers see HTML; fetch/curl/JSON clients see JSON."""
    if format_param:
        return format_param.lower() == "html"
    accept = request.headers.get("accept", "").lower()
    return "text/html" in accept


@app.get(
    "/about",
    tags=["meta"],
    summary="Author and license credits",
    description=(
        "Public credits endpoint. Browsers see a themed HTML page; "
        "API clients (Accept: application/json or ?format=json) get the same "
        "data as JSON. Also reachable from the web console via the Konami "
        "code (↑ ↑ ↓ ↓ ← → ← → B A) or five quick clicks on the ⌘ logo."
    ),
    response_model=None,
    responses={
        200: {
            "content": {
                "application/json": {"schema": AboutResponse.model_json_schema()},
                "text/html": {},
            },
        },
    },
)
def about(request: Request, format: str | None = None) -> Response:
    if _wants_html(request, format):
        return HTMLResponse(_render_about_html(_ABOUT_INFO))
    return JSONResponse(_ABOUT_INFO.model_dump())


@app.get("/egress-ip", response_model=EgressIpResponse)
def egress_ip() -> EgressIpResponse:
    """Outbound public IP as seen from the internet (same NAT path as most JDBC deployments)."""
    try:
        request = urllib.request.Request(
            _EGRESS_PROBE_URL,
            headers={"User-Agent": "sn-sql-api egress-ip probe"},
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=_EGRESS_PROBE_TIMEOUT_S) as response:
            raw = response.read().decode().strip()
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                candidate = parsed.get("ip")
                if isinstance(candidate, str) and candidate.strip():
                    return EgressIpResponse(ip=candidate.strip())
        except json.JSONDecodeError:
            pass
        if raw and all(c.isprintable() for c in raw) and "\n" not in raw:
            return EgressIpResponse(ip=raw)
    except urllib.error.URLError as exc:
        return EgressIpResponse(error=f"Could not reach ipify: {exc}")
    except TimeoutError:
        return EgressIpResponse(error="Timed out resolving egress address.")
    except OSError as exc:
        return EgressIpResponse(error=f"Network error: {exc}")

    return EgressIpResponse(error="Unexpected response from egress probe.")


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


@app.get(
    "/debug/ui-serving",
    include_in_schema=False,
    summary="Which bundled UI files this process serves (Docker troubleshooting)",
)
def debug_ui_serving() -> dict[str, object]:
    """Shows the resolved `static/dist` path, asset fingerprints, and bind-mount hints.

    If `app_src_bind_mount` is set, `/app/src` is mounted from the host (typical
    dev compose) and **overrides** the UI that was copied into the image — use
    `http://localhost:5173` for the Vite UI or drop the `./src` volume for prod.
    """
    return _ui_serving_probe()


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
        — it proxies <code>/query</code>, <code>/schema/*</code>,
        <code>/health</code>, <code>/egress-ip</code>, and
        <code>/about</code> to this API.
      </p>
      <p>
        To build a production bundle into the image, run
        <code>npm run build</code> inside <code>web/</code> or rebuild with
        <code>docker compose build</code>.
      </p>
      <p>
        API docs are always available at <a href="/docs">/docs</a>.
      </p>
      <p style="margin-top:18px;font-size:11px;color:#6e7681;">
        Made by
        <a href="https://www.linkedin.com/in/rafaelmessias/"
           target="_blank" rel="noopener noreferrer">Rafael Messias</a>
        — MIT licensed. See <a href="/about">/about</a>.
      </p>
    </main>
  </body>
</html>
"""


_API_ONLY_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>sn-sql-api · API-only mode</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
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
      .eyebrow {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #3fb950;
        margin: 0 0 6px;
      }
      h1 { margin: 0 0 8px; font-size: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      p { color: #8b949e; line-height: 1.6; margin: 8px 0; font-size: 13px; }
      code {
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
      ul { margin: 12px 0 4px; padding: 0 0 0 20px; color: #8b949e; font-size: 13px; line-height: 1.7; }
      .footer { margin-top: 18px; font-size: 11px; color: #6e7681; }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">// headless</p>
      <h1>sn-sql-api · API-only mode</h1>
      <p>
        The web SQL console is disabled because <code>API_ONLY=true</code> is
        set. The REST API is fully functional and ready for callers.
      </p>
      <ul>
        <li><a href="/docs">/docs</a> &mdash; Swagger UI</li>
        <li><a href="/health">/health</a> &mdash; lightweight liveness</li>
        <li><code>POST /health/check</code> &mdash; JDBC handshake</li>
        <li><code>POST /query</code> &mdash; run SQL</li>
        <li><code>POST /schema/tables</code> &middot; <code>POST /schema/columns</code></li>
        <li><a href="/about">/about</a> &mdash; credits &amp; license</li>
      </ul>
      <p>
        To re-enable the console, remove or set <code>API_ONLY=false</code> in
        your <code>.env</code> and restart the container.
      </p>
      <p class="footer">
        Made by
        <a href="https://www.linkedin.com/in/rafaelmessias/"
           target="_blank" rel="noopener noreferrer">Rafael Messias</a>
        &mdash; MIT licensed. See <a href="/about">/about</a>.
      </p>
    </main>
  </body>
</html>
"""


if settings.api_only:

    @app.get("/", include_in_schema=False, response_class=HTMLResponse)
    def api_only_root() -> str:
        return _API_ONLY_HTML

elif DIST_INDEX.exists():
    _log_bundled_ui_serving()
    app.mount(
        "/",
        _SpaStaticFiles(directory=str(DIST_DIR), html=True),
        name="web",
    )
else:

    @app.get("/", include_in_schema=False, response_class=HTMLResponse)
    def dev_placeholder() -> str:
        return _DEV_FALLBACK_HTML
