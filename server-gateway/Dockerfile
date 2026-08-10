# HelixQL gateway — the stateless translation and guardrail tier.
#
# Two stages so the final image carries only the interpreter and the
# installed packages: pip, its cache, and any build tooling stay behind in
# the builder. Nothing about a customer's database is ever baked in — this
# tier holds no credentials and connects to no customer database.

# --- Stage 1: build the virtualenv ---------------------------------------
FROM python:3.12-slim AS builder

# Bytecode and buffering both work against a container: .pyc files bloat the
# layer, and buffered stdout means logs arrive late or not at all when a
# process is killed.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Copied alone, before the source, so the dependency layer stays cached
# across every change that does not touch requirements.txt.
COPY requirements.txt .

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt

# --- Stage 2: runtime -----------------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY app ./app

# Run as an unprivileged user. A translation service that never touches the
# filesystem has no reason to hold root inside its own container.
RUN useradd --create-home --shell /usr/sbin/nologin helixql \
    && chown -R helixql:helixql /app
USER helixql

# Documentation only — Render (and most hosts) route to whatever $PORT says.
EXPOSE 8000

# Render injects $PORT and expects the process to bind it on 0.0.0.0. The
# shell form is required for that expansion; the fallback keeps `docker run`
# working locally without setting anything.
#
# No --workers: Render's smaller instances are single-CPU, and the service is
# I/O-bound on upstream model calls rather than CPU-bound, so extra workers
# would multiply memory for no throughput.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
