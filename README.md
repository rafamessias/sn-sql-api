# ServiceNow SQL API (Python + JDBC + Docker)

This project implements a containerized Python API to run SQL queries through the **ServiceNow JDBC driver** using the same connection model as the official documentation:

- JDBC driver JAR from your instance
- Driver class name from the doc for that JAR
- JDBC URL with `Server=`, `User=`, and `Password=` (or paste the full URL from the doc)

**Authoritative setup:** [Configure JDBC driver](https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html) and [Create JDBC connection](https://www.servicenow.com/docs/r/zurich/platform-security/connections-and-credentials/create-JDBC-connection.html).

Optional companion guide: [ServiceNow JDBC · Python Container Setup](https://rafamessias.github.io/sn-sql-api/).

## 1) Prerequisites

- Docker and Docker Compose
- ServiceNow JDBC `.jar` file

## 2) Configure environment

Copy the example file and fill your values:

```bash
cp .env.example .env
```

Required values in `.env`:

- `SN_INSTANCE` (example: `mycompany.service-now.com`)
- `SN_USERNAME`
- `SN_PASSWORD`
- `SN_JDBC_JAR_PATH` (must match container path, default `/app/drivers/servicenow-jdbc.jar`)

Optional values:

- `SN_JDBC_DRIVER_CLASS` — must match the **driver class** in [Configure JDBC driver](https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html) for your JAR (default `com.simba.servicenow.jdbc.Driver` if that matches your download).
- `SN_JDBC_URL` — paste the full JDBC URL from the doc or your instance for an exact match. If unset, the API builds the standard doc shape: `jdbc:servicenow:Server=https://<instance>;User=...;Password=...;`
- `API_KEY` (if set, `/query` and `/debug/jdbc-auth` require `x-api-key` header)

## 3) Add JDBC driver

Create a `drivers` folder and place your JDBC JAR in it:

```bash
mkdir -p drivers
```

Expected default filename/path:

- host: `./drivers/servicenow-jdbc.jar`
- container: `/app/drivers/servicenow-jdbc.jar`

## 4) Run

```bash
docker compose up --build
```

API will be available at `http://localhost:8000`.

## 5) Web SQL console

A browser-based SQL client is served by the same container at the root URL. The UI is a small **Preact + TailwindCSS** app built with Vite; it shares the visual identity of the [companion setup guide](https://rafamessias.github.io/sn-sql-api/) (GitHub‑dark theme with IBM Plex fonts).

Open `http://localhost:8000/` (or `http://localhost:5173/` in dev mode — see §6). The console has three tabs and a global **connection selector** in the header.

### Editor tab

- Type a query and press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>, or click **Run query**.
- Results render in a **virtualized, sortable table** with sticky headers and row‑count badge — smooth with tens of thousands of rows.
- Click any column header to sort (asc → desc → off). `NULL`, numbers and booleans are styled distinctly.
- **Copy CSV** copies the current result set to the clipboard.
- The query is run against whichever connection is currently active. If "Server default" is selected, the server uses values from `.env`.
- If `API_KEY` is set in `.env`, the browser UI does **not** send `x-api-key`; queries and schema calls will return **401** unless you use **curl** / **Swagger** with the header, put a reverse proxy in front that injects the key, or leave `API_KEY` unset for local-only use.

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

Every API call from the UI includes the active connection in the request body (the backend already accepts an optional `connection` object on `/query`, `/schema/tables`, and `/schema/columns`). When the active connection is **Server default**, no override is sent and the backend uses `.env` settings as before.

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

- Passwords saved via the Connections tab live in your browser's `localStorage` **unencrypted**. Use the UI only on trusted machines, or stick with **Server default** (which keeps secrets in `.env` server‑side).
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
| `web-dev`     | `http://localhost:5173`   | Node 20 container running `npm install && npm run dev`. Vite HMR; proxies `/query`, `/health`, `/debug/*` to the backend over the compose network. |

Open `http://localhost:5173/`. Tailwind classes and Preact components hot‑reload instantly; Python edits reload the API. No image rebuild is needed unless `requirements.txt`, `Dockerfile`, or `web/package.json` changes.

> The Vite container's `node_modules` lives in a named Docker volume (`web_node_modules`), so it doesn't fight whatever you may have on your host. The first `up` takes a bit longer because it installs deps; subsequent runs are fast.

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
| GET    | `/health`          | none                      | Liveness + active instance + driver class |
| POST   | `/query`           | `x-api-key`               | Run arbitrary SQL. Body: `{ query, parameters?, connection? }` |
| POST   | `/schema/tables`   | `x-api-key`               | List tables via JDBC metadata. Body: `{ pattern?, connection? }` |
| POST   | `/schema/columns`  | `x-api-key`               | List columns of a table. Body: `{ table, connection? }` |
| GET    | `/debug/jdbc-auth` | `x-api-key`               | Masked diagnostics about the configured connection |

The optional `connection` body field on `/query`, `/schema/tables`, and `/schema/columns` accepts:

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
- The JDBC JAR and `SN_JDBC_DRIVER_CLASS` must match the **same** driver. Follow [Configure JDBC driver](https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html) for the Simba connector (`jdbc:servicenow:Server=https://…;User=…;Password=…;`). If your instance only provides `ServiceNow-JDBC-*.jar` whose service file lists `com.snc.db.jdbc.JDBCDriver`, set `SN_JDBC_DRIVER_CLASS` to that class: the API then uses `jdbc:servicenow://<host>` plus JDBC `user` / `password` properties instead of the Simba URL string.
