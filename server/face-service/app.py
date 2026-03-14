"""
HappyDo Guard — Face Detection & Embedding Service
Uses InsightFace (RetinaFace + ArcFace) to detect faces and generate 512D embeddings.
Runs as a lightweight HTTP service consumed by the Node.js API.
"""

import io
import logging
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from insightface.app import FaceAnalysis
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face-service")

face_app = None
yolo_model = None

# COCO class 0 = "person"
PERSON_CLASS_ID = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global face_app, yolo_model
    logger.info("Loading InsightFace model (buffalo_l)...")
    t0 = time.time()
    face_app = FaceAnalysis(
        name="buffalo_l",
        providers=["CPUExecutionProvider"],
    )
    # det_size: detection input size. Smaller = faster, larger = more accurate
    face_app.prepare(ctx_id=0, det_size=(640, 640))
    logger.info(f"InsightFace model loaded in {time.time() - t0:.1f}s")

    logger.info("Loading YOLOv8n model for person detection...")
    t1 = time.time()
    yolo_model = YOLO("yolov8n.pt")
    logger.info(f"YOLOv8n model loaded in {time.time() - t1:.1f}s")

    yield
    logger.info("Shutting down face service")


app = FastAPI(title="HappyDo Guard Face Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": face_app is not None,
        "person_detection_loaded": yolo_model is not None,
    }


@app.post("/detect")
async def detect_faces(file: UploadFile = File(...)):
    """
    Detect faces in an image and return bounding boxes + 512D embeddings.

    Accepts: JPEG/PNG image upload
    Returns: { faces: [{ bbox, confidence, embedding, face_image_b64 }] }
    """
    if face_app is None:
        raise HTTPException(503, "Model not loaded yet")

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty file")

    # Decode image
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Invalid image")

    t0 = time.time()
    faces = face_app.get(img)
    elapsed = time.time() - t0

    results = []
    for face in faces:
        bbox = face.bbox.astype(int).tolist()
        confidence = float(face.det_score)
        embedding = face.embedding.tolist()

        # Crop face for thumbnail (with margin)
        h, w = img.shape[:2]
        x1, y1, x2, y2 = bbox
        margin = int((x2 - x1) * 0.2)
        cx1 = max(0, x1 - margin)
        cy1 = max(0, y1 - margin)
        cx2 = min(w, x2 + margin)
        cy2 = min(h, y2 + margin)
        face_crop = img[cy1:cy2, cx1:cx2]

        # Encode face crop as JPEG base64
        import base64
        _, buf = cv2.imencode(".jpg", face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        face_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        results.append({
            "bbox": bbox,
            "confidence": confidence,
            "embedding": embedding,
            "face_image_b64": face_b64,
        })

    logger.info(f"Detected {len(results)} face(s) in {elapsed*1000:.0f}ms")
    return JSONResponse({"faces": results, "elapsed_ms": round(elapsed * 1000)})


@app.post("/embed")
async def embed_photo(file: UploadFile = File(...)):
    """
    Generate embedding for a single photo (for search queries).
    Expects a photo with exactly one face.
    Returns: { embedding: [...], confidence }
    """
    if face_app is None:
        raise HTTPException(503, "Model not loaded yet")

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty file")

    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Invalid image")

    faces = face_app.get(img)
    if len(faces) == 0:
        raise HTTPException(404, "No face detected in the photo")

    # Use the face with highest confidence
    best = max(faces, key=lambda f: f.det_score)
    return {
        "embedding": best.embedding.tolist(),
        "confidence": float(best.det_score),
        "faces_found": len(faces),
    }


@app.post("/detect-persons")
async def detect_persons(file: UploadFile = File(...)):
    """
    Detect persons (full body) in an image using YOLOv8n.
    Much more reliable than face-only detection for triggering recordings,
    as it detects people from any angle (back, side, far away).

    Accepts: JPEG/PNG image upload
    Returns: { persons: [{ bbox, confidence }], count, elapsed_ms }
    """
    if yolo_model is None:
        raise HTTPException(503, "YOLO model not loaded yet")

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty file")

    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Invalid image")

    t0 = time.time()
    results = yolo_model(img, classes=[PERSON_CLASS_ID], conf=0.4, verbose=False)
    elapsed = time.time() - t0

    persons = []
    for r in results:
        for box in r.boxes:
            bbox = box.xyxy[0].cpu().numpy().astype(int).tolist()
            confidence = float(box.conf[0])
            persons.append({
                "bbox": bbox,
                "confidence": confidence,
            })

    if persons:
        logger.info(f"Detected {len(persons)} person(s) in {elapsed*1000:.0f}ms")

    return JSONResponse({
        "persons": persons,
        "count": len(persons),
        "elapsed_ms": round(elapsed * 1000),
    })
