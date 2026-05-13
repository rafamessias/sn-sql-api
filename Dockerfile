# syntax=docker/dockerfile:1.7

# ── 1) Build the Preact + Tailwind UI ─────────────────────────────────────────
FROM node:20-alpine AS web-builder

WORKDIR /web

# Install deps using the lock file when available so builds are reproducible.
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

COPY web ./
# Single layer: UI output + stamp (open http://localhost:8000/ui-image-build.txt to verify this image).
RUN npm run build \
    && printf "ui-image-build %s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/ui-image-build.txt


# ── 2) Python runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY src /app/src

# Replace any empty or leftover dist dir so we never merge new assets onto a
# stale host-built tree from an older COPY layer.
RUN rm -rf /app/src/static/dist

# Drop the built UI alongside the Python source so FastAPI can serve it.
COPY --from=web-builder /web/dist /app/src/static/dist

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
