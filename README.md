# ServiceNow SQL API (Python + JDBC + Docker)

This project implements a containerized Python API to run SQL queries through the **ServiceNow JDBC driver** using the same connection model as the official documentation:

- JDBC driver JAR from your instance
- Driver class name from the doc for that JAR
- JDBC URL with `Server=`, `User=`, and `Password=` (or paste the full URL from the doc)

**Authoritative setup:** [Configure JDBC driver](https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html) and [Create JDBC connection](https://www.servicenow.com/docs/r/zurich/platform-security/connections-and-credentials/create-JDBC-connection.html).

### What changed recently (repo highlights)

- **Docker image:** multi-stage build — **Node 20** runs `npm ci` / `npm run build` for the Preact + Tailwind UI, then **Python 3.11-slim** installs dependencies, **OpenJDK headless (JRE)** for JDBC, and the built UI is copied to `/app/src/static/dist` so FastAPI serves the console at `/`.
- **Two JDBC modes in `config.py`:** (1) **Simba** driver (`com.simba.servicenow.jdbc.Driver` by default) uses the doc-style URL with `Server=…;User=…;Password=…;`. (2) **Native instance JAR** (`com.snc.db.jdbc.JDBCDriver`) uses `jdbc:servicenow://https://<host>` plus JDBC `user` / `password` properties. If you set `SN_JDBC_URL` yourself, URLs starting with `jdbc:servicenow://` get `https://` inserted after the prefix when missing, so they match what the native driver expects.
- **`SN_INSTANCE`:** you can pass a short name (e.g. `mycompany`) or a full host; the app strips `https://` and, when there is no `.` in the value, appends `.service-now.com`.
- **`POST /health/check`:** opens a real JDBC connection (same stack as `/query`) and returns `ok` or `error` plus driver class and optional instance label. Optional body `{ "connection": { … } }` matches other endpoints. When `API_KEY` is set, this route requires `x-api-key` (the bundled UI does not send it — see security notes below).
- **Dev Compose:** `web-dev` sets `VITE_BACKEND_URL=http://sn-sql-api:8000` and **polling** env vars (`CHOKIDAR_USEPOLLING`, `VITE_USE_POLLING`) so file watching works reliably on **WSL2** and bind-mounted volumes.

### JDBC setup wizard (GitHub Pages)

The interactive **EN / PT-BR** step-by-step guide (live config panel, `.env` generator, copy-ready snippets, troubleshooting) ships in [`docs/`](./docs/). **Live site:** [rafamessias.github.io/sn-sql-api](https://rafamessias.github.io/sn-sql-api/).

If you maintain this repo: open **GitHub → Settings → Pages**, choose **Deploy from a branch**, set branch **`main`** and folder **`/docs`** so the wizard stays separate from the Python project root. Editing `docs/index.html` and pushing redeploys the site within about a minute.

## 1) Prerequisites

- Docker with Compose (v2 plugin or `docker-compose`)
- A ServiceNow JDBC `.jar` from your instance (often named like `ServiceNow-JDBC-2.0.0.jar`)

## 2) Configure environment

Copy the example file and fill your values:

```bash
cp .env.example .env
```

Edit `.env`. The checked-in [`.env.example`](./.env.example) targets the **native** driver and a typical instance JAR name; adjust to match what you actually use.

**Required**

- `SN_INSTANCE` — short name (e.g. `mycompany`) or full hostname (`mycompany.service-now.com`).
- `SN_USERNAME` / `SN_PASSWORD` — JDBC credentials.
- `SN_JDBC_JAR_PATH` — path **inside the container** to the mounted file. It must match the filename you put under `./drivers/` on the host, for example `/app/drivers/ServiceNow-JDBC-2.0.0.jar`.

**Optional**

- `SN_JDBC_DRIVER_CLASS` — must match the driver class for your JAR (Simba vs native). Defaults to `com.simba.servicenow.jdbc.Driver`; use `com.snc.db.jdbc.JDBCDriver` for the instance download JAR when that is what you ship.
- `SN_JDBC_URL` — full JDBC URL override; normalized for native `jdbc:servicenow://…` URLs as described above.
- `API_KEY` — if set, protected routes require the `x-api-key` header (see §5 and §7).

## 3) Add JDBC driver

Create a `drivers` folder and copy your JDBC JAR there. The name on disk must line up with `SN_JDBC_JAR_PATH`:

```bash
mkdir -p drivers
cp /path/to/your/ServiceNow-JDBC-2.0.0.jar drivers/
```

Compose bind-mounts the folder read-only:

| Host (repo)     | Container        |
| --------------- | ---------------- |
| `./drivers/`    | `/app/drivers/`  |

Example: file `./drivers/ServiceNow-JDBC-2.0.0.jar` → set `SN_JDBC_JAR_PATH=/app/drivers/ServiceNow-JDBC-2.0.0.jar`.

## 4) Run with Docker

**Build and start** (foreground logs; first build runs the UI `npm` stage, so it can take a few minutes):

```bash
docker compose up --build
```

**Run in the background:**

```bash
docker compose up --build -d
```

**What you get**

| Item | Value |
| ---- | ----- |
| Service | `sn-sql-api` (see [`docker-compose.yml`](./docker-compose.yml)) |
| API + UI | `http://localhost:8000` |
| JDBC files | Host `./drivers` → container `/app/drivers` (read-only) |
| Process | `uvicorn src.main:app --host 0.0.0.0 --port 8000` |

**Smoke checks**

```bash
curl -s http://localhost:8000/health | jq .
```

You should see `status`, `instance`, and `jdbc_driver_class`. Open **`http://localhost:8000/`** in a browser for the SQL console (served from the image build). Swagger is at **`http://localhost:8000/docs`**.

**Stop**

- Foreground: `Ctrl+C`, then `docker compose down`.
- Background: `docker compose down`.

**Rebuild** when you change `Dockerfile`, `requirements.txt`, or the `web/` app and need a fresh image: `docker compose build --no-cache` then `docker compose up`.

## 5) Web SQL console

A browser-based SQL client is served by the same container at the root URL. The UI is a small **Preact + TailwindCSS** app built with Vite; it shares the visual identity of the [JDBC setup wizard](https://rafamessias.github.io/sn-sql-api/) (GitHub‑dark theme with IBM Plex fonts).

Open **`http://localhost:8000/`** after `docker compose up` (or **`http://localhost:5173/`** in dev mode — see §6). The console has three tabs and a **connection** dropdown in the header (default option **`.env`** = server-side credentials from your container environment).

### Quick start

1. With the stack running (§4), open the UI URL and confirm the header status badge settles on **connected** (green). It uses **`POST /health/check`** to open a JDBC connection for the active selection.
2. Leave **`.env`** selected to use the instance and credentials from the compose `env_file`, or pick a saved connection from the **Connections** tab.
3. On **Editor**, run something small, for example `SELECT number FROM incident LIMIT 5` — <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> or **Run query**.
4. Use **Schema** to discover tables and columns, then **Open in Editor** to refine SQL.

### Editor tab

- Type a query and press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>, or click **Run query**.
- Results render in a **virtualized, sortable table** with sticky headers and row‑count badge — smooth with tens of thousands of rows.
- Click any column header to sort (asc → desc → off). `NULL`, numbers and booleans are styled distinctly.
- **Copy CSV** copies the current result set to the clipboard.
- The query runs against whichever connection is active. If **`.env`** is selected, the server uses only values from the container `.env` (no per-request override).
- If `API_KEY` is set, the bundled UI still does **not** send `x-api-key`. **`POST /query`**, **`POST /schema/*`**, and **`POST /health/check`** then return **401**, so the badge shows an error and queries fail. For local use, omit `API_KEY`, or call the API with **`curl` / Swagger** and the header, or terminate TLS at a gateway that injects the key.

### Schema tab (table tree + visual builder)

- Click **Discover tables** to load the schema for the active connection via standard JDBC metadata (`DatabaseMetaData.getTables`). Results are cached in memory per connection.
- Use the **search box** to filter the table list, then pick a table to load its columns (`DatabaseMetaData.getColumns`).
- Click columns to add them to the `SELECT` list (or use **Select all**). Each column shows its JDBC type and `NOT NULL` flag.
- Compose `WHERE`, `ORDER BY` and `LIMIT` with simple controls — the generated SQL preview updates live below.
- **Open in Editor** switches to the Editor tab with the generated query filled in, ready to run. **Copy** copies the SQL to the clipboard.

### Connections tab (multi-connection management)

- **+ New connection** — capture `name`, `JDBC URL`, `username`, `password`, optional `driver class`. Saved in `localStorage`.
- **Set active** — make any saved connection the one used by Editor and Schema tabs. The header dropdown reflects the choice.
- **Edit** / **Delete** — manage entries individually.
- **Export JSON** — downloads `sn-sql-connections-<date>.json`:
  ```json
  {
    "format": "sn-sql-api.connections.v1",
    "exported_at": "2026-05-12T21:00:00.000Z",
    "connections": [ { "id": "...", "name": "Prod", "url": "...", "user": "...", "password": "...", "driverClass": "" } ]
  }
  ```
- **Import JSON** — picks any file in that format (or a bare array of connection objects). Connections are **merged by name**: existing names are updated, new names are appended.

### How "active connection" affects the backend

The UI sends an optional `connection` object on **`POST /query`**, **`POST /schema/tables`**, **`POST /schema/columns`**, and **`POST /health/check`**. When **`.env`** is selected, no override is sent and the server uses the container `.env` only.

Programmatic example:

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT number FROM incident LIMIT 5",
    "connection": {
      "url": "jdbc:servicenow://my.service-now.com",
      "user": "service.account",
      "password": "***",
      "driver_class": "com.snc.db.jdbc.JDBCDriver"
    }
  }'
```

### Security notes

- Passwords saved via the Connections tab live in your browser's `localStorage` **unencrypted**. Use the UI only on trusted machines, or stick with **`.env`** as the active connection (secrets stay server-side in the container environment).
- The `/` page is unauthenticated. When `API_KEY` is set, protected routes require `x-api-key`; the bundled UI does not send it (use curl, a gateway, or unset `API_KEY` for local dev).
- Do not expose the container publicly without a reverse proxy / network policy in front; the `/query` endpoint executes arbitrary SQL.

## 6) Dev workflow (no full container rebuild)

### One‑line dev mode (recommended)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This single command starts **both** services:

| Service       | URL                       | What it does                                                            |
| ------------- | ------------------------- | ----------------------------------------------------------------------- |
| `sn-sql-api`  | `http://localhost:8000`   | FastAPI + JDBC, `src/` bind‑mounted, `uvicorn --reload` — edit Python and it reloads. |
| `web-dev`     | `http://localhost:5173`   | Node 20 Alpine: `npm install && npm run dev`. Vite HMR; proxies `/query`, `/schema`, `/health`, `/debug` to `sn-sql-api:8000` (`VITE_BACKEND_URL` in [`docker-compose.dev.yml`](./docker-compose.dev.yml)). |

Open `http://localhost:5173/`. Tailwind classes and Preact components hot‑reload instantly; Python edits reload the API. No image rebuild is needed unless `requirements.txt`, `Dockerfile`, or `web/package.json` changes.

> The Vite container's `node_modules` lives in a named Docker volume (`web_node_modules`), so it doesn't fight whatever you may have on your host. The first `up` takes a bit longer because it installs deps; subsequent runs are fast.

> **WSL2 / Docker Desktop:** [`docker-compose.dev.yml`](./docker-compose.dev.yml) sets `CHOKIDAR_USEPOLLING` and `VITE_USE_POLLING` on `web-dev` so file saves inside bind mounts trigger HMR reliably.

To stop everything: `Ctrl+C`, then `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`.

### Tip: add a shell alias

```bash
alias sn-dev='docker compose -f docker-compose.yml -f docker-compose.dev.yml up'
```

Then dev mode is literally one word: `sn-dev`.

### Other supported flows

If you'd rather run Node on your host (no `web-dev` container):

```bash
# Terminal 1 — backend with hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up sn-sql-api

# Terminal 2 — UI
cd web && npm install && npm run dev
```

Or run everything natively, no Docker:

```bash
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
# In another terminal:
cd web && npm install && npm run dev
```

The Vite proxy target is configurable via `VITE_BACKEND_URL` (default `http://localhost:8000`).

### Production build of the UI

```bash
cd web && npm run build   # outputs to web/dist
```

The next `docker compose build` picks up the bundle through the Dockerfile's multi‑stage build and copies it into `src/static/dist`, where FastAPI serves it from `/`. If `src/static/dist/index.html` is missing (e.g. you ran `pip` + `uvicorn` without building the UI), `/` shows a small placeholder page with the dev instructions, and the API endpoints stay fully functional.

## 7) HTTP endpoints

Interactive API docs (Swagger UI): `http://localhost:8000/docs`.

| Method | Path | Auth (when `API_KEY` set) | Purpose |
| ------ | ------------------ | ------------------------- | ------- |
| GET    | `/health`          | none                      | Lightweight JSON: `status`, `instance`, `jdbc_driver_class` (no JDBC connect) |
| POST   | `/health/check`    | `x-api-key`               | Opens a JDBC connection to verify credentials. Body: `{ connection? }` — omit or `{}` for `.env` defaults |
| POST   | `/query`           | `x-api-key`               | Run arbitrary SQL. Body: `{ query, parameters?, connection? }` |
| POST   | `/schema/tables`   | `x-api-key`               | List tables via JDBC metadata. Body: `{ pattern?, connection? }` |
| POST   | `/schema/columns`  | `x-api-key`               | List columns of a table. Body: `{ table, connection? }` |
| GET    | `/debug/jdbc-auth` | `x-api-key`               | Masked diagnostics about the configured connection |

The optional `connection` body field on `/query`, `/schema/tables`, `/schema/columns`, and `/health/check` accepts:

```json
{
  "url": "jdbc:servicenow://my.service-now.com",
  "user": "service.account",
  "password": "...",
  "driver_class": "com.snc.db.jdbc.JDBCDriver"
}
```

When omitted, the server falls back to `.env` settings.

### Examples

```bash
curl http://localhost:8000/health

# JDBC handshake using .env defaults (requires x-api-key when API_KEY is set)
curl -X POST http://localhost:8000/health/check \
  -H "Content-Type: application/json" \
  -d '{}'

curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT * FROM incident LIMIT 5"}'

# With API key + per-request connection override
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "query":"SELECT number, short_description FROM incident LIMIT 5",
    "connection": {
      "url":"jdbc:servicenow://my.service-now.com",
      "user":"service.account",
      "password":"***"
    }
  }'

# List tables matching a pattern
curl -X POST http://localhost:8000/schema/tables \
  -H "Content-Type: application/json" \
  -d '{"pattern":"incident%"}'

# Columns for a single table
curl -X POST http://localhost:8000/schema/columns \
  -H "Content-Type: application/json" \
  -d '{"table":"incident"}'
```

## Project layout

```
.
├── Dockerfile                 # multi-stage build: Node (UI) + Python (API)
├── docker-compose.yml         # production-style run
├── docker-compose.dev.yml     # hot-reload override (src volume + --reload)
├── docs/                      # GitHub Pages wizard (index.html + favicons)
├── src/                       # FastAPI service
│   ├── config.py
│   ├── jdbc_client.py
│   ├── main.py
│   └── static/dist/           # built UI is copied here at image build time
├── web/                       # Preact + Tailwind UI (Vite)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── app.tsx
│       ├── main.tsx
│       ├── components/
│       ├── hooks/
│       └── lib/
└── drivers/                   # mount your JDBC .jar here
```

## Notes

- This API executes SQL text passed by the caller. Restrict access (network policy, API key, or gateway auth) before exposing it.
- Keep secrets only in `.env` or secure secret management.
- The JDBC JAR and `SN_JDBC_DRIVER_CLASS` must match the **same** driver. Follow [Configure JDBC driver](https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html) for the Simba connector (`jdbc:servicenow:Server=https://…;User=…;Password=…;`). If your instance ships `ServiceNow-JDBC-*.jar` with `com.snc.db.jdbc.JDBCDriver`, set that class: the API uses `jdbc:servicenow://https://<host>` plus JDBC `user` / `password` properties instead of embedding credentials in the Simba-style URL string.

## Author

This app was developed by **Rafael Messias** — [LinkedIn](https://www.linkedin.com/in/rafaelmessias/).
