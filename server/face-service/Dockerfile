FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Remove build tools to reduce image size
RUN apt-get purge -y --auto-remove build-essential \
  && rm -rf /var/lib/apt/lists/*

# Pre-download InsightFace model at build time
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])" || true

# Pre-download YOLOv8n model for person detection at build time
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || true

COPY app.py .

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
