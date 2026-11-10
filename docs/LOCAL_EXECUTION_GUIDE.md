# Local execution guide (Windows PowerShell)

This guide describes the current application, with the local settings verified in this workspace: Node backend at `http://localhost:3101`, Vite frontend at `http://localhost:5180`, and the backend health route at `http://localhost:3101/health`. The root launcher fixes the frontend port at 5180 and reads the backend `PORT` from `server/.env` (default 3000). The optional AI service uses port 8000. No MediaMTX service or IP-camera integration is present in the current project.

## Prerequisites

- Windows 10/11 and PowerShell.
- Node.js 20.19+ or 22.12+; the tested local installation was Node `v22.23.4` at `C:\Users\shruj\AppData\Local\Author Software\nvm\installs\v22.23.4`.
- npm (included with the installed Node distribution).
- A current browser. Use localhost for local webcam/microphone permissions.
- Python and model weights only if you want to run the optional AI service. Python packages are listed in `ai-service/requirements.txt`; weights are not included.

## 1. Open the project and select Node

```powershell
$project = 'C:\Users\shruj\OneDrive\Documents\5G_Live_Lab_Assist_2.0'
$nodeHome = 'C:\Users\shruj\AppData\Local\Author Software\nvm\installs\v22.23.4'
Set-Location $project
$env:Path = "$nodeHome;$env:Path"
& "$nodeHome\node.exe" --version
```

Expected Node output is `v22.23.4`. On another machine, replace `$nodeHome` with the directory containing that machine's supported `node.exe`, or use its normal `node` and `npm` commands.

## 2. Install dependencies

The package includes `server/package-lock.json` and `client/package-lock.json`. Install only if the respective `node_modules` folders are absent or incomplete:

```powershell
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" run setup
```

This invokes the existing setup script, which installs backend and frontend packages from their lockfiles/package manifests. It does not install Python packages or download AI weights.

## 3. Configure local environment files safely

Do not replace an existing `.env` file. For a clean source ZIP, create local files only if they do not exist:

```powershell
if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
if (-not (Test-Path .\client\.env.local)) { Copy-Item .\client\.env.example .\client\.env.local }
notepad .\server\.env
notepad .\client\.env.local
```

For the packaged example configuration, set these local development values in `server/.env`:

```text
NODE_ENV=development
PORT=3101
CLIENT_ORIGIN=http://localhost:5180
PROFESSOR_ENROLLMENT_KEY=professor-demo-key
STUDENT_ENROLLMENT_KEY=student-demo-key
MAX_STUDENTS_PER_SESSION=3
AI_SERVICE_URL=http://127.0.0.1:8000
DATA_DIR=./data
```

Keep the optional admin setting empty unless you use that role. The demo enrollment keys are for local development only. The source defaults to those two demo values only when the environment variables are absent; blank values in `.env` disable registration for that role.

Set `VITE_SERVER_URL=http://localhost:3101` in `client/.env.local`. In this workspace those settings already exist. The guide never asks you to copy a real `.env` file into the source package.

## 4. Start the application

### Recommended: one terminal

In the project root, using the Node setup from step 1:

```powershell
& "$nodeHome\node.exe" .\scripts\start.js
```

Keep this terminal open. The existing launcher starts the backend and Vite together. It reports their addresses and stops both when you press **Ctrl+C** in this terminal.

### Alternative: separate terminals

Open two PowerShell windows. In each, set `$nodeHome`, prepend it to `PATH`, and change to `$project` as in step 1.

**Terminal A — backend:**

```powershell
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" --prefix .\server start
```

**Terminal B — frontend:**

```powershell
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" --prefix .\client run dev -- --host 0.0.0.0 --port 5180 --strictPort
```

Keep both terminals open. Stop each service with **Ctrl+C** in its own terminal. Do not also run the root launcher at the same time.

## 5. Check services and open the app

In a third PowerShell window:

```powershell
Invoke-RestMethod 'http://localhost:3101/health' | ConvertTo-Json -Depth 4
(Invoke-WebRequest 'http://localhost:5180/' -UseBasicParsing).StatusCode
```

The API should return `status: ok`; the frontend should return HTTP `200`. Open <http://localhost:5180> and register/login as professor and student using the local keys from step 3. Create the session as professor, then join it as student.

## 6. Optional AI service

The application has a FastAPI/Ultralytics YOLO inference service under `ai-service/`. It is not started by the main launcher. This workspace has no AI virtual environment, no local model weights, and its AI test step skipped because FastAPI and Pillow are not installed. Generic YOLO COCO weights are not bundled. You need an approved local `yolo11n.pt` file before successful inference can be demonstrated.

After obtaining compatible Python and approved weights, open a separate PowerShell terminal:

```powershell
Set-Location "$project\ai-service"
py -0p
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
New-Item -ItemType Directory -Force .\models | Out-Null
Copy-Item 'C:\path\to\approved\yolo11n.pt' '.\models\yolo11n.pt'
$env:YOLO_MODEL = (Resolve-Path '.\models\yolo11n.pt').Path
$env:AI_DEVICE = 'cpu'
& .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Package installation can download a large inference stack. The model path must point to an existing file. The optional `START_AI.bat` creates a virtual environment and installs requirements automatically if needed; do not run it unless you intend to perform that installation. Check the service in another terminal:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/health' | ConvertTo-Json -Depth 3
```

Health only indicates that the process responds; it does not confirm model weights loaded. Start AI inference from the professor's live-session panel after a student video is active. Stop the AI terminal with **Ctrl+C**.

## 7. Tests and build

From the project root, run the existing complete JavaScript verification:

```powershell
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" run verify
```

To also check the optional Python AI image-input tests:

```powershell
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" run verify:ai
```

The AI check skips with instructions when FastAPI/Pillow are unavailable. `verify` runs the backend integration suite, frontend unit tests, lint, and frontend production build.

## Common problems

- **Port 5180 or 3101 is already in use (`EADDRINUSE`)**: an existing instance or another process is listening. Check ownership; do not start a second copy. Stop the known project instance with Ctrl+C in its terminal. To inspect listeners:

  ```powershell
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 5180,3101,3000,8000 } |
    ForEach-Object { $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{Port=$_.LocalPort;PID=$_.OwningProcess;Process=$p.ProcessName} } |
    Format-Table -AutoSize
  ```

- **Frontend loads but requests fail**: check `VITE_SERVER_URL`, backend `PORT`, and exact `CLIENT_ORIGIN` match. Restart Vite and backend after editing environment files.
- **Registration says enrollment key invalid**: use the role-specific local key from step 3; blank environment variables disable that role. Do not use development keys for deployment.
- **Webcam/microphone unavailable**: allow browser permission on `localhost`; close another browser/profile that may have exclusive access to the webcam.
- **No WebRTC connection on a restrictive network**: current browser configuration has a public STUN server but no configured TURN relay. Some NAT/firewall paths need university-provided TURN or network changes.
- **AI inference unavailable**: confirm FastAPI health, `AI_SERVICE_URL`, dependencies, and an existing local `YOLO_MODEL` weights file. Do not expect `health` alone to verify inference.
- **No IP-camera menu or MediaMTX process**: this capability is not implemented in the current project. The current app uses student browser camera/microphone feeds through WebRTC.
