# 5G Live Lab Assist 2.0

## 1. Project objective

5G Live Lab Assist is a small-group remote laboratory collaboration app. It lets a student share a browser camera/microphone stream with a professor, who can view the student feed, annotate it, capture regions of interest, and share snapshots with the session.

The project explores browser-to-backend network monitoring, browser WebRTC statistics and optional sampled-frame AI. The name describes the intended deployment context; a localhost run does not demonstrate a 5G radio path, and the application does not expose radio KPIs.

## 2. Problem statement

Remote laboratory guidance needs a way for a professor to observe a student's live view and mark areas for attention. This project combines a browser video session with authenticated roles, shared session state, annotations, ROI snapshots, and separate network measurements. The current design is a small-group peer-to-peer demo, not an SFU or production remote-lab control system.

## 3. Implemented features

- Professor and student registration/login with role-specific enrollment keys, registered browser IDs, bcrypt password hashes, bearer sessions and authorization.
- Professor-created sessions with invite codes and up to three active student participants.
- Socket.IO signaling and WebRTC student camera/microphone streams.
- Professor live-video annotations and shared ROI snapshots/workspace with snapshot history and versioning.
- Browser WebRTC endpoint statistics and student sender-side High/Medium/Low adaptive video controls.
- Authenticated HTTP application-path monitoring with periodic bounded upload/download samples.
- Optional FastAPI service for generic YOLO COCO object detection on sampled video frames.
- Professor image benchmark UI/API for configured MEC and cloud inference endpoints.
- Linux deployment preparation: Nginx reverse proxy, Node/AI systemd service templates and environment examples.

**Not implemented in this version:** Ethernet IP camera/MediaMTX/ONVIF, 5G radio/air-interface metrics, an SFU, or a configured TURN relay. Cloud inference is not configured in the current local environment. AI inference requires external Python packages and a local model file.

Feature-level evidence and test limitations are in [docs/FEATURE_VERIFICATION.md](docs/FEATURE_VERIFICATION.md).

## 4. System architecture

    Professor browser  <-- direct WebRTC media -->  Student browser(s)
          |                                             |
          +------ HTTPS/API + Socket.IO signaling ------+
                                 |
                     Node.js / Express backend
                 auth, sessions, signaling, snapshots
                                 |
                    optional AI inference proxy
                                 |
                    FastAPI + local YOLO weights

The professor and student browsers send WebRTC signaling through the backend; browser media is peer-to-peer. The backend persists users, audit records, session metadata, membership, snapshots and history under DATA_DIR. Auth tokens and live participant connections are in memory and reset on backend restart.

The MEC monitor measures browser-observed HTTP response and periodic transfer throughput to the application backend. WebRTC peer metrics are calculated separately from RTCPeerConnection stats. Neither measurement is a 5G radio KPI.

For MEC deployment, Nginx serves the frontend and proxies HTTPS/API/Socket.IO traffic to Node. The optional Python AI service listens on loopback. The deployment files are templates only; the college VM has not been configured. See [deploy/README.md](deploy/README.md).

## 5. Technologies

- React 19 and Vite frontend.
- Node.js, Express 5 and Socket.IO backend.
- Browser WebRTC for peer-to-peer media.
- Optional Python FastAPI, Pillow and Ultralytics YOLO.
- Nginx and systemd templates for a Linux edge host.

Exact JavaScript dependencies and versions are recorded in package manifests and lockfiles. Python dependency ranges are in ai-service/requirements.txt.

## 6. Hardware and software requirements

### Core local app

- Windows 10/11, macOS or Linux.
- Node.js 20.19+ or 22.12+ with npm.
- Current browser with WebRTC support.
- Webcam and microphone for the student stream.

### Optional AI

- Python environment compatible with the listed requirements.
- FastAPI/Pillow/Ultralytics packages.
- A locally installed YOLO model file provided from an approved source. Model weights are not included.

### Multi-device/MEC experiment

- A second browser profile is enough to try both roles on one laptop, but a webcam may be exclusive to one profile.
- Independent camera/microphone and network tests need separate devices.
- Actual device-to-MEC testing needs the college server and network access. A 5G-connected device is needed to test the intended 5G path.

## 7. Installation

Clone or extract the clean source package and open PowerShell in the project root. Confirm Node:

    node --version
    npm --version

Install the frontend/backend dependencies with the repository setup script:

    npm run setup

The root launcher can also install missing JavaScript dependencies when started. Do not run package installation for AI unless you intend to download its larger optional stack.

## 8. Environment configuration

Copy example files only if a private local file does not already exist. Never overwrite real environment files:

    if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
    if (-not (Test-Path .\client\.env.local)) { Copy-Item .\client\.env.example .\client\.env.local }

For the local 5180/3101 configuration, set in server/.env:

- NODE_ENV=development
- PORT=3101
- CLIENT_ORIGIN=http://localhost:5180
- local development professor and student enrollment keys
- DATA_DIR=./data
- AI_SERVICE_URL=http://127.0.0.1:8000 (optional; this only configures the URL)

Set VITE_SERVER_URL=http://localhost:3101 in client/.env.local. In this workspace those settings already exist. The actual workspace config was verified at frontend 5180/backend 3101.

Local demo enrollment keys in source are professor-demo-key and student-demo-key only when the environment variables are absent. Never use them in production. Production requires unique role secrets, HTTPS CLIENT_ORIGIN, absolute persistent DATA_DIR, and a protected environment file. See deploy/.env.example.

## 9. Start the app locally

Recommended: start both core processes in one terminal from the project root:

    npm start

Open http://localhost:5180. Backend health is http://localhost:3101/health for the verified workspace configuration. The launcher fixes Vite at port 5180 and reads the backend port from server/.env; without that local setting the backend defaults to port 3000.

Alternatively, start the backend and frontend in separate terminals:

    npm --prefix .\server start

    npm --prefix .\client run dev -- --host 0.0.0.0 --port 5180 --strictPort

Stop each with Ctrl+C in its terminal. If a port reports EADDRINUSE, identify and stop the existing project process rather than starting a duplicate.

Detailed PowerShell commands, optional AI instructions, health checks and troubleshooting are in [docs/LOCAL_EXECUTION_GUIDE.md](docs/LOCAL_EXECUTION_GUIDE.md).

## 10. Experiment procedure

1. Start the backend and frontend; check the backend health endpoint.
2. Register/login as professor in one browser profile and as student in a separate profile.
3. Create a session as professor and join it as student using its session code.
4. Allow student camera/microphone and confirm the professor receives a WebRTC feed.
5. Draw/clear annotations; capture an ROI and confirm the snapshot appears in the shared workspace.
6. Observe peer WebRTC metrics and apply a manual video profile; automatic adaptation requires real network conditions and browser support.
7. Observe the HTTP MEC monitor. Record whether the path is localhost, LAN or an edge host.
8. Demonstrate AI only after installing dependencies/weights and confirming an actual inference.
9. Run the MEC inference benchmark with an explicitly selected image sample and a configured inference service.

The full experimental setup, success/failure observations and separate-device/5G requirements are in [docs/EXPERIMENT_EXECUTION_GUIDE.md](docs/EXPERIMENT_EXECUTION_GUIDE.md).

## 11. Testing instructions and current status

Run the existing JavaScript verification suite:

    npm run verify

It runs the backend integration suite, frontend unit tests, lint, and production build. Optional AI image-input tests:

    npm run verify:ai

On 2026-11-10, npm run verify:all completed successfully. The backend suite passed; 14 frontend unit tests passed; lint exited successfully with existing warnings; the production build passed. The optional AI tests were skipped because FastAPI and Pillow were not installed. A startup check returned API health ok and frontend HTTP 200; AI at port 8000 was unavailable.

No end-to-end browser video test, physical multi-device test, real 5G test, AI inference run, cloud/MEC comparative run, or college server deployment has been completed.

## 12. MEC deployment

Linux templates are in deploy/: Node and optional AI systemd units, Nginx reverse proxy, and server environment template. The existing [deploy/README.md](deploy/README.md) documents install commands and the required administrator-provided hostname, certificates, production secrets, service account, persistent directory, firewall and DNS.

These files have not been tested on the university VM. The admin must configure TLS/Nginx, keep backend and AI ports private, open only approved routes, and ensure devices can reach the host. Hosting the app at MEC does not by itself prove that traffic used 5G or an edge route.

## 13. Known limitations

- WebRTC media is peer-to-peer, not relayed through a media server; restrictive NAT/firewalls may require TURN, which is not configured.
- Actual browser camera codecs, audio/video quality, multi-device behavior, and live adaptive changes require manual tests.
- HTTP RTT/throughput is the browser-to-application path, not radio latency or packet loss.
- No 5G radio, slicing, QoS, or one-way air-interface measurements are implemented.
- YOLO weights and optional Python dependencies are not included; labels are generic COCO, advisory, and not lab-specific.
- Cloud benchmarking is not part of the current MEC-only benchmark workflow.
- No Ethernet IP camera, MediaMTX or ONVIF feature exists in this version.
- Linux MEC templates are not deployed or validated on a college server.
- Lint currently reports warnings in existing code; they do not block the build.

## 14. Reproducibility package and guides

The existing `5G_Live_Lab_Assist_2.0_reproducibility.zip` is a local generated artifact and is intentionally excluded from Git; regenerate it after source changes before sharing. The legacy edge bundle is also excluded because it contains an outdated frontend endpoint. The source, lockfiles, scripts, example configurations, deployment templates, and documentation are the Git-ready project contents.

- [Local execution guide](docs/LOCAL_EXECUTION_GUIDE.md)
- [Experiment execution guide](docs/EXPERIMENT_EXECUTION_GUIDE.md)
- [Demonstration video guide](docs/DEMO_VIDEO_GUIDE.md)
- [Feature verification matrix](docs/FEATURE_VERIFICATION.md)
- [Linux deployment instructions](deploy/README.md)
