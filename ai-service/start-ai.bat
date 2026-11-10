@echo off
cd /d "%~dp0"
if not defined YOLO_MODEL set "YOLO_MODEL=%CD%\models\yolo11n.pt"
if not defined AI_DEVICE set "AI_DEVICE=cpu"
if not exist ".venv\Scripts\python.exe" (
  py -m venv .venv
  call .venv\Scripts\python.exe -m pip install --upgrade pip
  call .venv\Scripts\python.exe -m pip install -r requirements.txt
)
call .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
