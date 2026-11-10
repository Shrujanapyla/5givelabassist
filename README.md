# 5G Live Lab Assist 2.0

5G Live Lab Assist is a browser-based remote laboratory collaboration prototype. A student can share a live camera/microphone stream with a professor. The professor can observe the feed, annotate it, and share selected regions as snapshots in a collaborative workspace. The app also reports browser WebRTC connection statistics and measures the HTTP path to its application backend.

> **5G scope:** “5G” describes the project’s intended edge-network use. A localhost run does not test a 5G connection. The app does not measure radio, air-interface, network-slice, or QoS KPIs.

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Run locally on Windows](#run-locally-on-windows)
- [First-use walkthrough](#first-use-walkthrough)
- [Feature guides](#feature-guides)
- [Optional AI service setup](#optional-ai-service-setup)
- [MEC inference benchmark](#mec-inference-benchmark)
- [Configuration reference](#configuration-reference)
- [Tests and verification](#tests-and-verification)
- [Security, data, and limitations](#security-data-and-limitations)
- [Linux/MEC deployment](#linuxmec-deployment)
- [Project layout](#project-layout)

## Features

### Accounts and access

- Professor, student, and administrator roles.
- Registration uses a role-specific enrollment key. Passwords are hashed with bcrypt.
- Browser/device IDs are registered with accounts; login is restricted to registered devices.
- Protected REST endpoints and Socket.IO events require authentication and check roles/session membership.
- Authentication, session, device, and security events are recorded in the backend audit log without recording passwords or enrollment keys.

### Live laboratory sessions

- A professor creates a session and shares its code with students.
- One professor and up to three students can join a session.
- Sessions expire after six hours by default.
- Socket.IO carries session state, annotations, and WebRTC signaling. Live audio/video is sent directly between browsers with WebRTC; it does not pass through the Node server.
- Targeted offer, answer, and ICE signaling supports a small-group professor/student star topology. This is not an SFU.

### Video, annotations, and shared workspace

- Students can enable their camera and microphone after joining a session.
- Professors can select a student feed, draw with a selected color, stop drawing, or clear annotations.
- **Capture region** crops a selected area from the active video into a shared ROI snapshot.
- The shared workspace supports multiple ROI panels, uploaded snapshots, notes, annotation overlays, snapshot versions/history, restore, and panel organization.
- Snapshot changes are broadcast to session members and persisted with session data. Editing is version-checked to prevent silently overwriting a newer snapshot.

### WebRTC quality and adaptive video

When a peer connection is active, the **Network quality** panel samples browser WebRTC statistics once per second. Available values may include connection state, round-trip time, jitter, packet-loss percentage, video bitrate, frame rate, and resolution. A field may show unavailable if the browser does not provide it.

Students can enable adaptive video or manually apply a High, Medium, or Low sender profile. The profiles cap bitrate/frame rate and adjust resolution scaling:

| Profile | Maximum bitrate | Maximum frame rate | Resolution scale |
|---|---:|---:|---:|
| High | 1.5 Mbps | 30 FPS | 1× |
| Medium | 0.8 Mbps | 24 FPS | 1.5× downscale |
| Low | 0.35 Mbps | 15 FPS | 2× downscale |

Automatic adaptation smooths samples, steps down after repeated poor conditions, and recovers gradually after sustained good conditions. RTT alone does not trigger a step-down. The browser may reject sender parameter changes; the UI reports this. Real encoder behavior still needs testing in a live browser call and suitable network conditions.

### MEC/application-path monitor

**5G & Edge monitoring** measures HTTP requests from the browser to the application backend. It supports 3-, 5-, and 10-second probe intervals, response/availability history, and periodic bounded throughput samples using 64 KiB uploads/downloads. The dashboard retains a rolling history of up to 60 measurements and shows whether the optional AI service is configured/available.

These are application-path measurements. They are not WebRTC peer metrics, radio latency, packet loss on the 5G air interface, or proof that traffic traversed a particular MEC/5G route. Label results as localhost, LAN, or university edge according to the actual test path.

### Optional AI object assistance

The professor can sample reduced frames from the selected student video and submit them through the authenticated backend to an optional FastAPI inference service. The UI shows detection boxes/labels, confidence, request and inference timings, processed/skipped counts, service status, and an adaptive/manual sampling policy. A suggested detection region can be captured into the shared workspace.

The supplied adapter uses a generic YOLO COCO model; it is not trained for laboratory equipment, does not determine experiment state, and is not a safety alarm. Python dependencies and weights are not included. The core launcher does not start the AI service, and the AI feature is unavailable until dependencies and a local model file are installed.

### MEC inference benchmark

The professor-only benchmark sends one explicitly selected PNG/JPEG/WebP image to the configured MEC-compatible `POST /detect` endpoint for 3, 5, or 10 sequential samples. Images must be at most 750 KiB. It reports total browser response, backend-to-endpoint request duration, inference time reported by the processor, sample chart, and success/failure counts. History lasts for the current browser session only.

This is an MEC-only benchmark. It does not send the laboratory video automatically or compare against a cloud endpoint. A configured URL alone is insufficient; the inference service and model must be running.

## Architecture

```text
Professor browser  <---- direct WebRTC media ---->  Student browser(s)
       |                                               |
       +----- HTTPS/API + Socket.IO signaling --------+
                              |
                    Node.js / Express backend
                 authentication, sessions, snapshots
                              |
                     optional AI proxy/API
                              |
                    FastAPI + local YOLO weights
```

The React/Vite frontend serves the UI. The Node.js/Express/Socket.IO service handles authentication, authorization, session state, persistence, signaling, monitoring endpoints, and optional AI proxy requests. The optional Python service handles image inference. For edge deployment, Nginx terminates HTTPS and proxies application traffic to Node; systemd templates are provided for Node and optional AI.

## Requirements

- Windows 10/11 with PowerShell, macOS, or Linux.
- Node.js **20.19+** (20.x) or **22.12+**, with npm.
- A current browser with WebRTC support. A camera and microphone are needed for live video.
- Two browser profiles/accounts for a simple local professor/student demo; separate devices provide a more realistic test.
- Optional AI: compatible Python, packages from `ai-service/requirements.txt`, and an approved YOLO model file.
- Optional Linux/MEC deployment: administrator-provided Linux VM, hostname, trusted TLS certificate, firewall/routing, persistent storage, and production secrets.

## Run locally on Windows

Open PowerShell in the project directory. From a new machine:

```powershell
git clone https://github.com/Shrujanapyla/5givelabassist.git
Set-Location .\5givelabassist
npm run setup
```

If you already have the project, just open PowerShell in its root folder. Install dependencies if they are missing:

```powershell
npm run setup
```

### Create local configuration

Create local files only when they do not already exist; this preserves existing configuration:

```powershell
if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
if (-not (Test-Path .\client\.env.local)) { Copy-Item .\client\.env.example .\client\.env.local }
```

Edit `server/.env` and set these local-development values:

```dotenv
NODE_ENV=development
PORT=3101
CLIENT_ORIGIN=http://localhost:5180
PROFESSOR_ENROLLMENT_KEY=professor-demo-key
STUDENT_ENROLLMENT_KEY=student-demo-key
MAX_STUDENTS_PER_SESSION=3
AI_SERVICE_URL=http://127.0.0.1:8000
DATA_DIR=./data
```

For core app use without AI, `AI_SERVICE_URL` can be left blank. The MEC benchmark and AI assistance will then be unavailable. To enable them, run the optional AI service as described below.

Edit `client/.env.local`:

```dotenv
VITE_SERVER_URL=http://localhost:3101
```

### Start and stop

From the project root, run one launcher:

```powershell
npm start
```

Keep the terminal open. Visit <http://localhost:5180>. Check backend health at <http://localhost:3101/health>; a healthy server responds with `status: ok`. Press **Ctrl+C** in the launcher terminal to stop both services.

Do not start duplicate launchers. If you see `Port 5180 is already in use`, first open <http://localhost:5180>—an earlier Vite instance may still be serving the app. If the app is not responding, close the old launcher using Ctrl+C in its terminal, then run `npm start` once.

To identify a process listening on either port:

```powershell
Get-NetTCPConnection -LocalPort 5180,3101 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

Check the process command before stopping it. Do not terminate an unknown process simply because it owns one of these ports.

### Run services separately (optional)

Use two terminals from the project root instead of `npm start`:

```powershell
npm --prefix .\server start
```

```powershell
npm --prefix .\client run dev -- --host 0.0.0.0 --port 5180 --strictPort
```

Stop each with Ctrl+C in its own terminal. Do not run these alongside the combined launcher.

## First-use walkthrough

1. Open the app in one browser profile. Register and sign in using the **Professor** role and the professor enrollment key from `server/.env`.
2. Open a separate browser profile. Register and sign in using the **Student** role and the student enrollment key.
3. As professor, select **Create session**, then copy/share the session code with the student.
4. As student, enter the code in **Session code** and select **Join session**.
5. As student, select **Enable camera and microphone** and approve the browser permission prompt.
6. As professor, view the student's live feed. Try **Start drawing**, **Clear drawings**, and **Capture region**.
7. View the result in **Shared snapshots workspace**. Check **Network quality** and **5G & Edge monitoring**.

Passwords must be 10–72 UTF-8 bytes. A browser/device must be registered to the account. If registration fails, confirm the role key is set correctly in `server/.env`; blank keys disable registration for that role. Do not place real credentials or personal lab data in screenshots or recordings.

## Feature guides

### Create/join a lab

Only a professor can create a session. Students join with its code. The server enforces session role, membership, and capacity. The default session lifetime is six hours. On a backend restart, persisted session/snapshot data remains, but in-memory login tokens and live peer connections are reset; users must sign in and reconnect.

### Share video

The student browser captures camera/microphone tracks and negotiates a peer connection with the professor. The Node server relays authenticated signaling messages; the media itself is peer-to-peer. Direct connectivity depends on browser permissions and network/NAT/firewall conditions. No TURN relay is configured. If a network blocks direct peers, a university-approved TURN service would need to be provisioned and configured.

### Annotate and capture a region

On an active professor view, select the feed, start drawing, and choose a color. Stop drawing or clear annotations when finished. Select **Capture region**, drag across the video, and release. The ROI appears in the shared workspace. Workspace panels can contain snapshots and versions; authorized members can add notes/drawings, inspect history, restore prior versions, and organize panels. The server enforces session membership and version checks.

### Understand monitoring metrics

- **Network quality** is derived from `RTCPeerConnection.getStats()` and represents the browser-to-browser WebRTC peer path. Fields can be unavailable depending on browser support or connection state.
- **5G & Edge monitoring** sends authenticated HTTP probes to the application backend. Every sixth successful probe, the browser attempts a 64 KiB upload/download throughput sample and checks optional service status.
- These two panels measure different paths. Neither reports a 5G radio KPI. A localhost result cannot be described as an edge or 5G result.

### Use adaptive video

The student can toggle **Adaptive video**. Automatic policy smooths values and requires repeated poor/good observations plus a cooldown before changing profile. Poor-state signals combine packet loss, jitter, very low bitrate, or failed connection; RTT alone does not trigger downshift. Manual profile controls remain available. The browser must support `RTCRtpSender.setParameters()` for changes to apply.

### Use AI object assistance

The optional pipeline samples a reduced frame from the currently selected student feed, sends it through the authenticated Node proxy, and calls FastAPI `/detect`. It returns normalized bounding boxes, labels, confidence, image dimensions, model name, and inference duration. The frontend overlays detections and can capture a suggested ROI. Adaptive sampling reacts to MEC path readings/failures; manual sampling profiles are also available.

AI status health does not guarantee the model weights are installed or loadable. Detection requests return unavailable until Python dependencies and a local model are ready. Generic COCO object labels may be wrong or irrelevant to lab work. Treat results as advisory only.

## Optional AI service setup

AI dependencies and YOLO weights are intentionally not installed by `npm run setup` or the core `npm start` command. Obtain model weights from an approved source; this project does not bundle weights.

In a separate PowerShell terminal:

```powershell
Set-Location .\ai-service
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
New-Item -ItemType Directory -Force .\models | Out-Null
Copy-Item 'C:\path\to\approved\yolo11n.pt' '.\models\yolo11n.pt'
$env:YOLO_MODEL = (Resolve-Path '.\models\yolo11n.pt').Path
$env:AI_DEVICE = 'cpu'
& .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Keep this terminal running. The app backend must have `AI_SERVICE_URL=http://127.0.0.1:8000` in `server/.env`; restart the backend after changing `.env`. Check the optional service at <http://127.0.0.1:8000/health>. Successful model inference also requires valid local weights; `/health` alone does not confirm model readiness.

To run the optional Python image tests after installing dependencies:

```powershell
& .\ai-service\.venv\Scripts\python.exe -m unittest discover -s .\ai-service -p 'test_*.py'
```

## MEC inference benchmark

The benchmark appears for professors and requires an active session and a configured MEC endpoint. When using the included FastAPI service, `AI_SERVICE_URL=http://127.0.0.1:8000` makes the backend call `http://127.0.0.1:8000/detect`.

1. Select a PNG, JPEG, or WebP test image no larger than 750 KiB.
2. Choose 3, 5, or 10 samples and select **Run benchmark**.
3. Review average, median, and P95 browser response, average endpoint request duration, average processor-reported inference time, and success/failure counts.
4. Use **Reset results** to clear results and history for the current browser session.

Browser total time includes upload, backend handling, inference, and response. Endpoint request time is measured by Node and includes transport/server handling. Processor time comes from the inference service. Upload-only time is not measured separately. Results are meaningful only for successful calls under a described test setup. No cloud endpoint or paired MEC/cloud comparison exists in this version.

## Configuration reference

| Setting | Purpose | Typical local value |
|---|---|---|
| `NODE_ENV` | Backend mode; use `production` for server deployment | `development` |
| `PORT` | Node backend port | `3101` |
| `CLIENT_ORIGIN` | Allowed frontend origin for CORS/Socket.IO | `http://localhost:5180` |
| `PROFESSOR_ENROLLMENT_KEY` | Professor registration key | local demo key only |
| `STUDENT_ENROLLMENT_KEY` | Student registration key | local demo key only |
| `ADMIN_ENROLLMENT_KEY` | Optional administrator registration key | blank locally unless needed |
| `MAX_STUDENTS_PER_SESSION` | Maximum students per room | `3` |
| `AI_SERVICE_URL` | Optional inference service base URL; backend appends `/detect` | `http://127.0.0.1:8000` |
| `DATA_DIR` | Backend directory for persistent user, audit, and session/snapshot data | `./data` |
| `VITE_SERVER_URL` | Frontend API/Socket.IO server URL | `http://localhost:3101` |

Environment files are local and ignored by Git. Copy from the examples, do not commit real values. In production the backend requires distinct strong professor/student enrollment secrets (at least 32 characters), valid HTTPS `CLIENT_ORIGIN`, and an absolute persistent `DATA_DIR`. An optional admin key must also be strong and unique.

## Tests and verification

Run all core and optional verification steps:

```powershell
npm run verify:all
```

Run the core suite only:

```powershell
npm run verify
```

The core suite runs backend integration checks, frontend unit tests, lint, and a production Vite build. The optional AI verification script skips when FastAPI/Pillow are absent. Lint currently reports existing warnings in `App.jsx`, `NetworkDashboard.jsx`, `RemoteVideoTile.jsx`, and `RoiViewport.jsx`; lint exits successfully and the production build passes.

**Latest verification run:** 2026-11-11, Node.js 22.23.4. Backend integration passed; 14 frontend unit tests passed; lint exited successfully with the warnings above; production build passed (70 modules). Optional AI checks skipped because FastAPI and Pillow are not installed. This suite does not test physical cameras, live cross-browser media, the university VM, or a real 5G path.

## Security, data, and limitations

- Local development demo enrollment keys are public examples. Never use them on a server.
- Use HTTPS and unique, high-entropy secrets in production. Protect the environment file and keep backend/AI ports private behind the reverse proxy/firewall.
- Passwords are bcrypt-hashed. Bearer auth tokens live in process memory for 12 hours and are invalidated by backend restart.
- User records, audit log, session membership, snapshots, and snapshot history persist under `DATA_DIR`. Live peer connections do not persist. Back up the data directory securely.
- The server rate-limits registration, login, session joins, monitoring probes, AI calls, and benchmark requests; it validates image payloads and checks roles/membership.
- This is a small-group peer-to-peer prototype, not an SFU, production remote-control system, certified security product, or lab safety system.
- No Ethernet IP camera, MediaMTX, ONVIF camera discovery, TURN relay, 5G radio KPIs, or network slicing/QoS implementation is included.
- Real WebRTC behavior, multi-device capacity, controlled adaptation, AI inference, MEC performance, TLS deployment, and the college 5G/edge path require separate runtime tests/access.

## Linux/MEC deployment

Linux templates are under `deploy/`: Nginx reverse proxy, Node and optional AI systemd services, and production environment examples. The [deployment instructions](deploy/README.md) describe administrator-provided hostnames, certificates, secrets, storage, firewall rules, and service setup. These templates have not been installed or validated on the university VM. A deployment on an edge server alone does not prove that a device's traffic used 5G or a particular edge route.

## Project layout

```text
ai-service/   Optional FastAPI/YOLO inference API and Python tests
client/       React/Vite interface and frontend tests
server/       Express/Socket.IO API, persistence, and integration tests
deploy/       Linux Nginx/systemd templates and examples
docs/         Technical feature-verification matrix
scripts/      Setup, start, verification, checkpoint, and resume helpers
screenshots/  Project UI images
```

This README is the complete user-facing project guide. The `docs/` directory contains the technical verification matrix; deployment-specific steps remain in `deploy/README.md`.
