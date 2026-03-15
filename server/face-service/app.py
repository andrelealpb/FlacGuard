"""
HappyDo Guard — Face Detection & Embedding Service
Uses InsightFace (RetinaFace + ArcFace) to detect faces and generate 512D embeddings.
Runs as a lightweight HTTP service consumed by the Node.js API.

Two-pass detection strategy for top-down / fisheye cameras:
  1. Try direct face detection on the full image (threshold 0.3)
  2. If no faces found, use YOLO to detect persons, crop the upper-body
     region, and retry face detection on each crop (threshold 0.2)
"""

import base64
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

# Detection thresholds — lower values catch more angled/partial faces
FACE_THRESH_FULL = 0.3       # direct detection on full image
FACE_THRESH_CROP = 0.2       # detection on YOLO person crops
PERSON_CONF = 0.4             # YOLO person confidence


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

    logger.info("Loading YOLO26n model for person detection...")
    t1 = time.time()
    yolo_model = YOLO("yolo26n.pt")
    logger.info(f"YOLO26n model loaded in {time.time() - t1:.1f}s")

    yield
    logger.info("Shutting down face service")


app = FastAPI(title="HappyDo Guard Face Service", lifespan=lifespan)


def _extract_face_result(face, img):
    """Convert an InsightFace detection to our API result dict."""
    bbox = face.bbox.astype(int).tolist()
    confidence = float(face.det_score)
    embedding = face.embedding.tolist()

    # Crop face for thumbnail (with margin)
    h, w = img.shape[:2]
    x1, y1, x2, y2 = bbox
    margin = int((x2 - x1) * 0.3)
    cx1 = max(0, x1 - margin)
    cy1 = max(0, y1 - margin)
    cx2 = min(w, x2 + margin)
    cy2 = min(h, y2 + margin)
    face_crop = img[cy1:cy2, cx1:cx2]

    _, buf = cv2.imencode(".jpg", face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    face_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    return {
        "bbox": bbox,
        "confidence": confidence,
        "embedding": embedding,
        "face_image_b64": face_b64,
    }


def _detect_faces_in_image(img, det_thresh=FACE_THRESH_FULL):
    """Run InsightFace on an image with given threshold."""
    face_app.det_model.det_thresh = det_thresh
    return face_app.get(img)


def _person_guided_detection(img):
    """
    Two-pass strategy for difficult camera angles (top-down, fisheye):
    1. Use YOLO to find person bounding boxes
    2. Crop the upper portion (head/shoulders) of each person
    3. Run face detection on each crop with lower threshold
    """
    if yolo_model is None:
        return []

    yolo_results = yolo_model(img, classes=[PERSON_CLASS_ID], conf=PERSON_CONF, verbose=False)
    persons = []
    for r in yolo_results:
        for box in r.boxes:
            persons.append(box.xyxy[0].cpu().numpy().astype(int).tolist())

    if not persons:
        return []

    logger.info(f"Person-guided: found {len(persons)} person(s), trying face detection on crops")

    h_img, w_img = img.shape[:2]
    all_faces = []
    seen_centers = set()

    for px1, py1, px2, py2 in persons:
        # Crop upper 50% of person bbox (head + shoulders area)
        person_h = py2 - py1
        upper_y2 = py1 + int(person_h * 0.5)

        # Add horizontal padding for angled views
        pad_x = int((px2 - px1) * 0.15)
        cx1 = max(0, px1 - pad_x)
        cy1 = max(0, py1)
        cx2 = min(w_img, px2 + pad_x)
        cy2 = min(h_img, upper_y2)

        crop = img[cy1:cy2, cx1:cx2]
        if crop.size == 0 or crop.shape[0] < 20 or crop.shape[1] < 20:
            continue

        # Try face detection on the crop with lower threshold
        faces = _detect_faces_in_image(crop, det_thresh=FACE_THRESH_CROP)

        for face in faces:
            # Adjust bbox back to full-image coordinates
            face.bbox[0] += cx1
            face.bbox[1] += cy1
            face.bbox[2] += cx1
            face.bbox[3] += cy1

            # Deduplicate (avoid same face from overlapping person boxes)
            center = (int((face.bbox[0] + face.bbox[2]) / 2),
                      int((face.bbox[1] + face.bbox[3]) / 2))
            key = (center[0] // 30, center[1] // 30)  # grid-based dedup
            if key not in seen_centers:
                seen_centers.add(key)
                all_faces.append(face)

    return all_faces


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
    Uses two-pass strategy: direct detection first, then person-guided
    detection for difficult camera angles.

    Accepts: JPEG/PNG image upload
    Returns: { faces: [{ bbox, confidence, embedding, face_image_b64 }], detection_method }
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

    t0 = time.time()

    # Pass 1: direct face detection on full image
    faces = _detect_faces_in_image(img, det_thresh=FACE_THRESH_FULL)
    detection_method = "direct"

    # Pass 2: if no faces found, try person-guided detection
    if not faces:
        faces = _person_guided_detection(img)
        if faces:
            detection_method = "person_guided"

    elapsed = time.time() - t0

    results = [_extract_face_result(f, img) for f in faces]

    logger.info(f"Detected {len(results)} face(s) in {elapsed*1000:.0f}ms via {detection_method}")
    return JSONResponse({
        "faces": results,
        "elapsed_ms": round(elapsed * 1000),
        "detection_method": detection_method,
    })


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
    Detect persons (full body) in an image using YOLO26n.
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
    results = yolo_model(img, classes=[PERSON_CLASS_ID], conf=PERSON_CONF, verbose=False)
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
