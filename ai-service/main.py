"""Optional sampled-frame AI service. Uses a generic COCO detector, not lab-specific safety AI."""
from __future__ import annotations

import base64
import io
import os
import time
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image

app = FastAPI(title="5G Live Lab Assist AI", version="1.0.0")
MAX_IMAGE_BYTES = 1_500_000
MAX_IMAGE_PIXELS = 12_000_000

class DetectRequest(BaseModel):
    image: str = Field(min_length=40, max_length=2_500_000)

@lru_cache(maxsize=1)
def load_model():
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError("Install ai-service/requirements.txt to enable YOLO inference") from exc
    model_path = Path(os.getenv("YOLO_MODEL", "yolo11n.pt")).expanduser()
    if not model_path.is_file():
        raise RuntimeError(f"Model weights not found at {model_path}. Install the model once and set YOLO_MODEL to its local file path.")
    return YOLO(str(model_path))

def decode_image(data_url: str) -> Image.Image:
    try:
        encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds the 1.5 MB inference limit")
        with Image.open(io.BytesIO(raw)) as source:
            if source.width < 16 or source.height < 16:
                raise HTTPException(status_code=400, detail="Image is too small")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image dimensions exceed the 12-megapixel inference limit")
            return source.convert("RGB")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image") from exc

@app.get("/health")
def health():
    return {"status": "ok", "service": "sampled-frame-ai", "model": os.getenv("YOLO_MODEL", "yolo11n.pt")}

@app.post("/detect")
def detect(payload: DetectRequest):
    image = decode_image(payload.image)
    started = time.perf_counter()
    try:
        model = load_model()
        result = model.predict(source=image, imgsz=640, conf=float(os.getenv("AI_CONFIDENCE", "0.35")), device=os.getenv("AI_DEVICE", "cpu"), verbose=False)[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Model inference failed: {exc}") from exc

    boxes = []
    names = result.names
    for item in (result.boxes if result.boxes is not None else []):
        x1, y1, x2, y2 = [float(value) for value in item.xyxy[0].tolist()]
        class_id = int(item.cls[0].item())
        confidence = float(item.conf[0].item())
        boxes.append({
            "label": str(names.get(class_id, class_id)),
            "confidence": round(confidence, 4),
            "box": {
                "x": max(0, min(1, x1 / image.width)),
                "y": max(0, min(1, y1 / image.height)),
                "width": max(0, min(1, (x2 - x1) / image.width)),
                "height": max(0, min(1, (y2 - y1) / image.height)),
            },
        })
    return {
        "detections": boxes,
        "inferenceMs": round((time.perf_counter() - started) * 1000, 2),
        "imageWidth": image.width,
        "imageHeight": image.height,
        "model": os.getenv("YOLO_MODEL", "yolo11n.pt"),
        "notice": "Generic COCO object detections are advisory and are not lab-specific or safety-critical.",
    }
