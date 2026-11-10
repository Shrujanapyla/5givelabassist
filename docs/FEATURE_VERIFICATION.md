# Current feature verification

Verification performed on 2026-11-10 in this Windows workspace. This status describes the source currently in the project. It does not reuse earlier camera-integration work; Ethernet IP camera/MediaMTX code was undone and is absent.

## Results summary

- npm run verify:all completed with exit code 0.
- Backend authenticated session/integration suite passed, including registration/device login, role restrictions, session capacity/isolation, snapshot broadcast/authorization/history persistence, targeted WebRTC signaling, metric relay, MEC probes, audit secrecy, health, and persistence checks.
- Frontend unit suite passed: 14 tests covering WebRTC metric summaries, adaptive policy/profile application, benchmark summaries, and AI detection geometry.
- Frontend lint returned success with existing warnings in NetworkDashboard.jsx, RoiViewport.jsx, RemoteVideoTile.jsx, and App.jsx; see limitations below.
- Vite production build passed (70 modules transformed).
- A real local startup check returned backend health ok and frontend HTTP 200. AI health at 127.0.0.1:8000 was unavailable.
- Optional AI Python tests were skipped by the existing runner because FastAPI and Pillow are not installed. YOLO weights are not bundled or present.
- No physical multi-device WebRTC test, actual 5G test, college MEC VM deployment, cloud inference run, or camera hardware test was performed.

## Feature matrix

| Feature | State (1–4) | Requires external/hardware/university access (5)? | Evidence and remaining validation |
|---|---|---|---|
| React frontend | **1 — Implemented and tested** | No | Production build passes; local Vite page returned HTTP 200. No full browser UI automation was run. |
| Node.js / Express backend | **1 — Implemented and tested** | No | Backend integration suite passed; local /health returned ok. |
| Socket.IO session signaling | **1 — Implemented and tested** | No | Integration suite exercised authenticated sockets, joining, session isolation, signaling, reconnect, and event relay. |
| Professor/student authentication and authorization | **1 — Implemented and tested** | College access is needed for production secrets/TLS | Integration suite covers role registration/login, invalid keys/devices, role restrictions, audit secrecy and session membership. |
| Session creation/join and multi-student capacity | **1 — Implemented and tested** | No for backend behavior; yes for physical multi-device validation | Backend suite joined professor plus three students and checked capacity, isolation, reconnect and persistence. This is server integration, not simultaneous physical browsers. |
| WebRTC media between browsers | **2 — Implemented, not runtime-tested here** | **Yes** — devices/cameras and network | Backend tests verify offer/answer/ICE routing only; actual capture, codecs, NAT traversal and remote audio/video need browser/device tests. |
| Live annotations | **2 — Implemented, not runtime-tested here** | Browser session; physical hardware not essential | UI canvas and session Socket.IO broadcast handlers exist. The suite did not perform end-to-end browser drawing. |
| ROI selection and shared workspace | **2 — Implemented, not runtime-tested here** | Browser session; physical hardware not essential | Crop/geometry helper tests passed; actual selection and browser rendering were not tested in a live session. |
| Snapshot broadcast, authorization and persistence | **1 — Implemented and tested** | No for backend behavior | Backend suite passed snapshot broadcast, student-update rejection, history/session persistence and cross-session isolation. Browser crop capture remains a manual UI test. |
| WebRTC network monitoring | **1 for metric calculation/relay; 2 for a live call** | **Yes** — active peer connection | Unit tests cover metric summaries; backend integration checks relay. No browser call verified actual device stats. |
| Adaptive video streaming | **1 for policy/profile setter tests; 2 for live adaptation** | **Yes** — browser sender and real network conditions | Unit tests check step-down/recovery and sender parameter calls. No controlled impairment or real browser encoder change was measured. |
| AI frame analysis / YOLO | **3 — Partially implemented** | **Yes** — Python packages and model weights | Inference code exists. Python tests skipped because dependencies are absent; no weights are present. The model is generic COCO, not lab-trained. |
| Network-aware AI sampling | **1 for policy logic; 2 for runtime** | **Yes** — running AI service and live MEC readings | Policy and frontend unit tests exist. No live probe plus successful AI inference session was run. |
| MEC/application-path monitoring | **1 for endpoint behavior; 2 for live remote-path measurement** | **Yes** — university edge/network for an MEC/5G-path result | Backend probes passed; UI is implemented. Localhost values are not 5G results. |
| MEC inference benchmark | **3 — UI/API present; inference not configured/tested** | **Yes** — working compatible MEC inference endpoint | Benchmark authorization/config was tested. The AI process is unavailable, so there is no measurement result. |
| 5G-specific radio/QoS/slicing measurement | **4 — Not implemented** | **Yes** for a physical 5G network, but the app has no radio instrumentation | No radio/air-interface, one-way latency, slice, or QoS fields exist. WebRTC stats and HTTP path probes do not provide those KPIs. |
| Ethernet IP camera / MediaMTX / ONVIF | **4 — Not implemented in current project** | **Yes** for a camera, but connecting one is insufficient | No camera manager, MediaMTX config/service, or camera source exists. The earlier integration was undone. |
| MEC Linux deployment | **2 — Templates implemented, deployment not runtime-tested** | **Yes** — college VM, administrator, DNS/TLS/firewall | deploy/README.md, Nginx, Node/AI systemd templates and examples exist. They have not been installed/validated on Linux or the college VM. |
| Security controls | **1 for tested checks; no full security audit** | College access is needed to validate production deployment controls | Backend tests cover auth/authorization, denied devices, session isolation and audit secrecy. TLS, production secrets, firewall/proxy and external review remain unverified. |

**State key:** 1 = implemented and successfully tested at the stated test level; 2 = implemented but not runtime-tested; 3 = partially implemented or requires unavailable services/data; 4 = not implemented. The separate column marks category 5: external hardware, services, or university access required for the corresponding real-world validation.

## Current local environment and verification details

- Node used: v22.23.4.
- Backend PORT: 3101; CLIENT_ORIGIN includes http://localhost:5180; frontend VITE_SERVER_URL: http://localhost:3101.
- Root launcher frontend port: 5180.
- AI_SERVICE_URL is configured as http://127.0.0.1:8000, but the service process was not available during the startup check.
- Cloud inference URL is unset. The benchmark must show the cloud endpoint as unconfigured.
- Current server/data contains local user/session/audit records; these files are excluded from the source ZIP.
- There is no ai-service/.venv, AI model weights, MediaMTX service, or college-edge deployment in the current project.

## Remaining acceptance tests

1. Use two separate physical devices and confirm real browser-to-browser video/audio and reconnect behavior.
2. Check browser camera permissions, codecs and restrictive-network behavior; a TURN service may be required, but none is configured in this project.
3. Observe the MEC dashboard over a sustained test path and label whether it is localhost, LAN, or university edge.
4. Perform controlled, authorized network impairment if demonstrating automatic bitrate adaptation; capture the actual profile transition and peer statistics.
5. If AI is required, install compatible Python packages and approved weights, then test inference and ROI alignment using the intended browser.
6. If benchmark comparison is required, configure a compatible MEC inference endpoint and an authorized cloud endpoint; run paired samples and retain genuine results.
7. Deploy the prepared Linux configuration only after the college administrator supplies hostname, TLS certificate, firewall/routing, service account, persistent storage and production secrets. Then repeat checks from a device on the intended 5G network. This is the only way to assess that university path; no such deployment was done here.

## Lint warnings observed

The oxlint command returned success but reported warnings in existing code: set-state-in-effect warnings in NetworkDashboard.jsx, RemoteVideoTile.jsx and App.jsx; ref access warnings in RoiViewport.jsx; a caught unused parameter and render-time Date call in App.jsx. They did not prevent the production build and were not changed as part of this documentation-only verification task.
