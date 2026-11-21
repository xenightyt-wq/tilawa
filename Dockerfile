# Image unique : PWA compilée + serveur de reconnaissance (FastAPI + faster-whisper).
#
#   docker build -t tilawa .                                   # CPU, modèle tarteel base (léger)
#   docker build -t tilawa --build-arg CUDA=1 \
#     --build-arg MODEL_ID=deepdml/whisper-small-ar-quran-mix-norm .   # GPU NVIDIA
#   docker run -p 8000:8000 tilawa            (GPU : ajouter --gpus all)

ARG MODEL_ID=tarteel-ai/whisper-base-ar-quran

# --- 1. Frontend -------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /src
COPY data-scripts ./data-scripts
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# --- 2. Conversion du modèle (outillage lourd, jeté ensuite) -----------------
FROM python:3.12-slim AS models
ARG MODEL_ID
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --group convert --no-install-project
COPY backend/scripts ./scripts
RUN .venv/bin/python scripts/convert_model.py "$MODEL_ID" \
 && mv models/*-ct2 /model

# --- 3. Image finale ---------------------------------------------------------
FROM python:3.12-slim
ARG CUDA=0
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN if [ "$CUDA" = "1" ]; then EXTRA="--extra cuda"; fi; \
    uv sync --frozen --no-dev $EXTRA --no-install-project && rm -rf /root/.cache
COPY backend/app ./app
COPY --from=models /model /app/models/model
COPY --from=web /src/frontend/dist /app/static
ENV ASR_MODEL=/app/models/model \
    STATIC_DIR=/app/static \
    PATH="/app/.venv/bin:$PATH" \
    LD_LIBRARY_PATH="/app/.venv/lib/python3.12/site-packages/nvidia/cublas/lib:/app/.venv/lib/python3.12/site-packages/nvidia/cudnn/lib"
EXPOSE 8000
# Un seul worker : le modèle est chargé une fois et partagé entre connexions.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
