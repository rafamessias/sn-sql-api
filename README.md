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

Example file (same keys as in the repo — copy to `.env` and replace values):

```env
SN_INSTANCE=mycompanyInstanceName
SN_USERNAME=service.account
SN_PASSWORD=replace_me
SN_JDBC_DRIVER_CLASS=com.snc.db.jdbc.JDBCDriver
SN_JDBC_JAR_PATH=/app/drivers/ServiceNow-JDBC-2.0.0.jar
API_ONLY=false
```

**`API_ONLY`** — when `false` (as in the template above), the process serves the bundled **web SQL console** at `GET /` alongside the REST API. When `true` (also `1`, `yes`, `on`), the app runs **headless**: all JSON routes behave the same, but `/` is a minimal landing page instead of the SQL UI — typical for production behind a gateway or when the browser client must stay off. Details in §4.1.

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

**Rebuild:** with the default compose file, **`docker compose up --build`** already skips layer cache (see below). If you overrode with `docker-compose.cached.yml`, run `docker compose build --no-cache` before `up` when something looks stale.

**If `/` still looks like an old build** after `up --build`: the API now sends **`Cache-Control: no-store`** for `/`, `/index.html`, `/assets/*`, and `/ui-image-build.txt` so a normal refresh picks up a new image; still try a private window if something looks stuck. Confirm `.env` does not set `API_ONLY=true`; run `docker compose down && docker compose up --build --force-recreate`. **See exactly which files the API is serving:** `curl -s http://localhost:8000/debug/ui-serving | jq .` — check `index_html_sha256`, `vite_module_script_src`, and `ui_image_build_stamp`. If **`app_src_bind_mount`** is non-null, `/app/src` is mounted from your host (for example you merged **dev** compose or use `docker-compose.override.yml` with `./src:/app/src`), so **`localhost:8000` uses that tree’s `src/static/dist`**, not the UI baked into the image — either use **`http://localhost:5173`** for the live Vite UI or remove the `./src` volume for a pure prod run. Check `curl -s http://localhost:8000/ui-image-build.txt` (**404** = stamp file absent on that bundle). On **Docker Desktop + WSL2**, run Compose from the **same repo path you edit** (Windows `C:\…` vs WSL `/home/…` clones differ). The image build ignores local `src/static/dist/` (see [`.dockerignore`](./.dockerignore)).

**Default image build is always “full”:** [`docker-compose.yml`](./docker-compose.yml) sets `build.pull: true` and `build.no_cache: true`, so **`docker compose up --build`** re-runs `npm ci` / `npm run build` for the UI and reinstalls Python deps from `requirements.txt` every time — you get the latest `web/` and `src/` from the directory where you run Compose. That is slower but avoids stale layers. For **cached** (faster) local iteration when you accept cache invalidation risk, add [`docker-compose.cached.yml`](./docker-compose.cached.yml):

```bash
docker compose -f docker-compose.yml -f docker-compose.cached.yml up --build
```

For CI, use the default compose from a **clean checkout** with a committed `web/package-lock.json` (the Dockerfile uses `npm ci` when the lockfile is present).

### Copy bundled UI from the image to `src/static/dist/` (optional)

[`docker-compose.yml`](./docker-compose.yml) defines **`sync-web-dist-to-host`** (profile **`sync-web-dist`**): a one-shot container that copies **`/app/src/static/dist`** from **`sn-sql-api:local`** into **`./src/static/dist`** on the host. The service shares the same **`build:`** as **`sn-sql-api`**, so **`--build`** runs the full Dockerfile first (including **`npm run build`** for `web/`), then copies the fresh bundle. Use it when **dev compose** bind-mounts `./src` and you want **`http://localhost:8000/`** to show the same bundle as the image (instead of only using **`http://localhost:5173`**).

```bash
docker compose --profile sync-web-dist run --build --rm sync-web-dist-to-host
```

If the image is already up to date, you can omit **`--build`** and the copy step alone runs faster.

Files may be owned by `root` inside the container; on Linux use `sudo chown -R "$(id -u):$(id -g)" src/static/dist` if needed.

### 4.1) API-only (headless) production mode

For production-style deployments where you only want to expose the REST surface — for example behind an API gateway, in a service-to-service context, or when the web console must stay off — set:

```bash
# .env
API_ONLY=true
```

Then `docker compose up` as usual. The same image runs in two modes; no rebuild is needed when you flip the flag.

| Path               | `API_ONLY=false` (default) | `API_ONLY=true` |
| ------------------ | -------------------------- | --------------- |
| `GET /`            | Web SQL console (Preact)   | Minimal "API-only" landing page that links to `/docs` |
| `GET /docs`        | Swagger UI                 | Swagger UI |
| `GET /health`      | JSON                       | JSON |
| `POST /query`, `POST /schema/*`, `POST /health/check`, `GET /about`, `GET /egress-ip`, `GET /debug/jdbc-auth` | Available | Available |

Notes:

- `API_ONLY` is independent of `API_KEY`. Combine them to require `x-api-key` **and** disable the UI for a production deployment: `API_KEY=…` + `API_ONLY=true`.
- Dev mode (§6) is unaffected — the `web-dev` service still runs Vite on `http://localhost:5173/` and proxies REST calls to the API container.
- The image still builds the UI bundle during `docker build`; only the runtime decides whether to serve it. This keeps a single, immutable image that you can promote across environments.

## 5) Web SQL console

A browser-based SQL client is served by the same container at the root URL. The UI is a small **Preact + TailwindCSS** app built with Vite; it shares the visual identity of the [JDBC setup wizard](https://rafamessias.github.io/sn-sql-api/) (GitHub‑dark theme with IBM Plex fonts).

Open **`http://localhost:8000/`** after `docker compose up` (or **`http://localhost:5173/`** in dev mode — see §6). The console has **Editor**, **Schema**, **Connections**, and **Logs** tabs and a **connection** dropdown in the header (default option **`.env`** = server-side credentials from your container environment).

### Quick start

1. With the stack running (§4), open the UI URL and confirm the header status badge settles on **connected** (green). It uses **`POST /health/check`** to open a JDBC connection for the active selection.
2. Leave **`.env`** selected to use the instance and credentials from the compose `env_file`, or pick a saved connection from the **Connections** tab.
3. On **Editor**, run something small, for example `SELECT number FROM incident LIMIT 5` — <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> or **Run query**.
4. Use **Schema** to discover tables and columns, then **Open in Editor** to refine SQL.

### Editor tab

- Type a query and press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>, or click **Run query**.
- Results render in a **virtualized, sortable table** with sticky headers and row‑count badge — smooth with tens of thousands of rows.
- Click any column header to sort (asc → desc → off). `NULL`, numbers and booleans are styled distinctly.
- **Export CSV** downloads the current result set as a comma-separated file.
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

> **`localhost:8000` in dev is not your Vite UI.** Dev compose bind‑mounts **`./src` → `/app/src`**, so **`src/static/dist/` on your host** is exactly what FastAPI serves at `/` on **8000**. If you **deleted** that folder (or never built into it), `/` shows the small **placeholder** HTML — the SQL console is still at **`http://localhost:5173`**. To serve the built SPA on 8000 during dev: `cd web && npm run build && mkdir -p ../src/static/dist && cp -r dist/* ../src/static/dist/`. **Prod-only** `docker compose up --build` (no `./src` mount) always bakes `dist` into the image, so deleting host `src/static` does not break that stack. Use `GET /debug/ui-serving` (`app_src_bind_mount` non-null ⇒ host `./src` is masking the image).

> The Vite container's `node_modules` lives in a named Docker volume (`web_node_modules`), so it doesn't fight whatever you may have on your host. The first `up` takes a bit longer because it installs deps; subsequent runs are fast.

> **WSL2 / Docker Desktop:** [`docker-compose.dev.yml`](./docker-compose.dev.yml) sets `CHOKIDAR_USEPOLLING` and `VITE_USE_POLLING` on `web-dev` so file saves inside bind mounts trigger HMR reliably.

To stop everything: `Ctrl+C`, then `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`.

> **If `up` fails with `network … not found` or warns about orphan containers** (e.g. after pruning networks or renaming a service): run **`docker compose -f docker-compose.yml -f docker-compose.dev.yml down --remove-orphans`**, then **`up`** again. That drops stale networks and removes one-off containers from old compose definitions.

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
| GET    | `/debug/ui-serving` | none                     | Which `static/dist` files this process serves (paths, `index.html` hash, bind-mount hint); use when Docker shows the “wrong” UI |
| GET    | `/about`           | none                      | Author and MIT license credits (also reachable from the UI via the Konami code or 5 clicks on the ⌘ logo) |

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
├── docker-compose.cached.yml  # optional: layer cache (faster, use with care)
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
