# syntax=docker/dockerfile:1
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Limit compilation parallelism to avoid OOM during insightface Cython build
ENV MAKEFLAGS="-j1" MAX_JOBS=1

# Install heavy deps first as separate cached layer (rarely changes)
# BuildKit cache mount keeps pip downloads across rebuilds even if layer cache is lost
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install cython numpy==1.26.4 \
  && pip install --no-build-isolation insightface==0.7.3

# Install remaining requirements (changes more often)
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Remove build tools to reduce image size
RUN apt-get purge -y --auto-remove build-essential \
  && rm -rf /var/lib/apt/lists/*

# Pre-download InsightFace model at build time
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])" || true

# Pre-download YOLO26n model for person detection at build time
RUN python -c "from ultralytics import YOLO; YOLO('yolo26n.pt')" || true

COPY app.py .

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
