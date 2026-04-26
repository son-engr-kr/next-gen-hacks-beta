# Cloud Run image for motzip-server (FastAPI).
# Multi-stage so the final image doesn't carry uv or build caches.

FROM python:3.11-slim AS builder

# uv is the package manager — copy from official image (no apt install needed).
COPY --from=ghcr.io/astral-sh/uv:0.7.7 /uv /uvx /bin/

WORKDIR /app

# Install dependencies in their own layer for cache reuse on code-only changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source + finalize project install.
COPY . .
RUN uv sync --frozen --no-dev


FROM python:3.11-slim AS runtime

WORKDIR /app

# Bring over the resolved venv + source from the builder.
COPY --from=builder /app /app

# Use the venv directly so we don't need uv in the runtime image.
ENV PATH="/app/.venv/bin:$PATH"

# Cloud Run injects $PORT (defaults to 8080). Bind to 0.0.0.0.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
