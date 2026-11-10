# 5G Live Lab Assist 2.0

A small-group remote laboratory collaboration app. A student shares a browser camera and microphone stream; a professor can view it, draw annotations, and share selected regions as snapshots. The dashboard includes WebRTC connection statistics and HTTP monitoring to the application server.

> The project name describes its intended edge deployment. Running locally does not test a 5G radio connection or measure radio KPIs.

## What’s included

- Professor and student accounts with role-based enrollment keys.
- Professor-created sessions with up to three student feeds.
- Browser-to-browser WebRTC audio/video with Socket.IO signaling.
- Live video annotations and a shared snapshots/ROI workspace.
- WebRTC quality indicators, adaptive video controls, and HTTP application-path monitoring.
- Optional AI object assistance and an image benchmark for a configured MEC inference service.
- Linux deployment templates for Nginx and systemd.

The MEC benchmark measures the configured MEC inference endpoint only. Ethernet IP camera/MediaMTX, ONVIF, TURN relay, SFU, and 5G radio KPI support are not included. AI requires separate Python dependencies and model weights.

## Run locally on Windows

### Requirements

- Windows 10/11 and PowerShell.
- Node.js 20.19+ or 22.12+ with npm.
- A current browser. Use two browser profiles for a basic professor/student demo.

### 1. Get the project and install dependencies

```powershell
git clone https://github.com/Shrujanapyla/5givelabassist.git
Set-Location .\5givelabassist
npm run setup
```

If the project is already on your computer, open PowerShell in its folder and skip the `git clone` and `Set-Location` commands.

### 2. Create local environment files

These commands keep existing local configuration files intact:

```powershell
if (-not (Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
if (-not (Test-Path .\client\.env.local)) { Copy-Item .\client\.env.example .\client\.env.local }
```

Edit `server/.env` and set the following local development values:

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

Edit `client/.env.local`:

```text
VITE_SERVER_URL=http://localhost:3101
```

The demo enrollment keys are for local development only. Use unique strong secrets and HTTPS for any production deployment. Never commit `.env` files or share them in screenshots.

### 3. Start the app

From the project root, run:

```powershell
npm start
```

Keep that terminal open. Visit **http://localhost:5180**. The backend health check is **http://localhost:3101/health** and should report `ok`. Stop the app with **Ctrl+C** in the terminal running it.

Run `npm start` only once. If you see **Port 5180 is already in use**, a Vite server may already be running; open the app URL before starting another copy. If it does not load, close the old app terminal with Ctrl+C, then retry. Do not stop an unknown process just because it owns that port.

## First-use walkthrough

1. Open the app in one browser profile and register/sign in with the **Professor** role and professor enrollment key.
2. Open a separate browser profile and register/sign in with the **Student** role and student enrollment key.
3. As professor, select **Create session** and share the session code with the student.
4. As student, enter the code and select **Join session**.
5. As student, select **Enable camera and microphone** and allow browser access.
6. As professor, view the student feed. Use **Start drawing** to annotate or **Capture region** to share a snapshot in **Shared snapshots workspace**.
7. Review **Network quality** and **5G & Edge monitoring**. Local measurements describe the local path only.

For the full walkthrough, including troubleshooting and optional features, see the [User Manual](docs/USER_MANUAL.md).

## Optional AI and MEC benchmark

The core launcher does not start the optional AI service. AI assistance and the MEC image benchmark require the Python inference service, compatible dependencies, and an approved local model. The benchmark also requires `AI_SERVICE_URL` in `server/.env` to point to the running service. Follow the [local execution guide](docs/LOCAL_EXECUTION_GUIDE.md) for AI setup. The benchmark sends only the image you select; it does not automatically upload lab video.

## Verification

```powershell
npm run verify
```

This runs backend integration checks, frontend unit tests, lint, and a production build. Optional AI checks can be attempted with:

```powershell
npm run verify:ai
```

The AI check may skip when its optional Python dependencies are not installed.

## Deployment and project guides

- [User Manual](docs/USER_MANUAL.md)
- [Windows local setup and troubleshooting](docs/WINDOWS_LOCAL_TESTING.md)
- [Local execution guide](docs/LOCAL_EXECUTION_GUIDE.md)
- [Experiment execution guide](docs/EXPERIMENT_EXECUTION_GUIDE.md)
- [Demo video guide](docs/DEMO_VIDEO_GUIDE.md)
- [Feature verification and limitations](docs/FEATURE_VERIFICATION.md)
- [Linux/MEC deployment instructions](deploy/README.md)

The Linux files are templates; the college VM, DNS, HTTPS certificate, firewall, and production secrets must be supplied/configured by the server administrator. A localhost run does not validate the university MEC or 5G network.

## Data and Git hygiene

Local environment files, backend user/session/audit data, dependencies, build output, model weights, and generated ZIP bundles are excluded by `.gitignore`. Keep real credentials out of source control. Do not use real student information in an unapproved demo.
