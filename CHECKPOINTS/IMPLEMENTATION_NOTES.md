# Implementation checkpoint notes

## Recovery baseline

- User-confirmed GitHub `master` merge commit: `f6b8b51`.
- The deliverable is reconstructed from the latest project archive in this conversation, the user-provided README/handoff, the Claude progress transcript and the six-page implementation guide. Claude's private/unexported workspace source was not available, so this is a verified reconstruction, not a byte-for-byte recovery of its private working tree.
- The user's latest request authorizes Module 1 deployment preparation. Nginx and systemd templates are in `deploy/`; do not claim university VM deployment or invent its host, certificates, or credentials.

## Resume/checkpoint rules

1. Run `npm run resume` before any future work.
2. Read `CHECKPOINTS/status.json` and this file before editing.
3. Preserve all modules marked implemented; don't recreate the repository or reset to an older archive.
4. After a meaningful step, record it with: `npm run checkpoint -- M2 verified "Metric delta test passed"` (replace module/status/note as appropriate).
5. Re-run relevant tests after changes and update `status.json` / `PROGRESS_LOG.md`.
6. Use `npm start` for the core app. It automatically installs missing Node dependencies and launches backend + frontend together. Optional AI runs separately because its ML dependencies and model weights are large.

## Module state

- **M2:** WebRTC `getStats()` metrics are wired into the dashboard and student sender-side samples are sent to the professor. Sender packet-loss/jitter feedback now uses `remote-inbound-rtp` when the browser exposes it. The frontend pure tests pass. Manual multi-browser test remains.
- **M3:** Adaptive High/Medium/Low encoding profiles, EWMA metric smoothing, hysteresis and cooldown are implemented and policy-tested. Browser-specific `RTCRtpSender.setParameters()` behavior and controlled network impairment remain manual acceptance tasks.
- **M1:** Nginx HTTPS/static hosting/reverse-proxy config, backend and optional AI systemd units, production environment example, and Linux deployment commands are prepared. VM setup, DNS, certificates and firewall remain administrator work.
- **M4:** Optional FastAPI/YOLO sampled-frame detector, overlay, alerts and capture-suggested-ROI path are implemented. The local model path is configurable and missing weights fail clearly without downloading at service startup. Detection responses carry session, source participant and frame timestamp. AI model inference was not run; weights are not bundled. It is a generic COCO detector, not a lab-specific model or safety mechanism.
- **M5:** Authentication, registered browser IDs, role/session guards, rate limits, auditing and production fail-fast enrollment configuration are implemented. Linux deployment stores users, audits, session metadata, membership, snapshots and history privately beneath `DATA_DIR`; process-memory tokens are invalidated on restart. The current backend integration suite passed with installed `bcryptjs`. TLS terminates at the prepared Nginx proxy in deployment templates; no trusted cert is bundled.
- **M6:** Three-student cap, participant grid with per-student camera/connection state, targeted WebRTC star topology, per-student metrics, reconnect and room isolation are implemented. Backend tests passed; real multiple-camera browser tests/load tests remain. This is not an SFU.

## Verification completed in this workspace

- Backend authenticated/session/multi-device integration suite: passed with installed `bcryptjs` under Node 22.23.4. It now also checks production secret rejection and persistence across restart (users, session membership, snapshots and history retained; participants/tokens cleared).
- Frontend pure tests: 8 passed (network stats including sender-side feedback, adaptive policy and smoothing, AI geometry).
- Frontend production build: passed with Vite 8.3.5. It was built with `VITE_SERVER_URL` explicitly empty, and a bundle check confirmed the existing local API URL from `client/.env.local` was not included.
- Python AI image input tests: not runnable in the current Python 3.14 install because it has no pip and Pillow is unavailable; a prior checkpoint recorded 3 passing tests.
- JavaScript syntax: all backend/script JS passed `node --check`; all 20 client JS/JSX files passed TypeScript transpile syntax check.
- Optional HTTPS backend smoke test: passed with a temporary self-signed cert.
- Frontend lint was not run.

## Remaining acceptance work (do not misrepresent)

- Follow `deploy/README.md` after university admin supplies the Linux VM, hostname, TLS certificates, service account, and firewall access.
- Open professor and two or three student browser profiles/devices; confirm each video tile, metrics and reconnect behavior.
- Use an authorized network-impairment setup to verify bitrate step-down and gradual recovery. Do not change shared router/UPF policies without administrator approval.
- Optionally install `ai-service/requirements.txt`, start the AI service, download/cache model weights and verify actual detection/overlay/ROI capture. Model inference has not been verified here.
- Configure trusted TLS certificates before exposing the application beyond localhost. Don't use demo enrollment keys outside local development.
- No university VM deployment, real 5G access-path, camera/browser, or actual YOLO model acceptance test is claimed.


## Checkpoint 4 — telemetry feedback and AI input hardening

- Added sender-side `remote-inbound-rtp` packet-loss/jitter support and a regression test.
- Added a 12-megapixel AI input ceiling before conversion and a large-image rejection test.
- Python AI test runner now uses the project virtual environment when present and gracefully explains how to install optional dependencies when absent.
- Latest test counts: frontend 8/8; Python AI input 3/3.
- Windows-native Oxlint/Vite production build and real hardware/network acceptance remain outstanding.

## Checkpoint 5 — deployment, persistence and production configuration

- Prepared Nginx HTTPS/static/API/Socket.IO routing, systemd units for Node and optional AI, production environment examples, and Linux VM setup/operations instructions. No university VM was accessed.
- Preserved the existing deployment-stage directory and edge ZIP as requested. The ZIP includes a legacy non-loopback endpoint; the supported deployment procedure builds a fresh same-origin frontend from current source.
- Added persistent session metadata, membership, snapshots, and snapshot history alongside the existing users/audit storage. Restart tests confirm active participants and process-memory tokens are cleared while durable records reload.
- Production backend startup now rejects missing, weak, placeholder, or role-reused enrollment keys and requires HTTPS origins and an absolute `DATA_DIR`. Private Linux data files use restrictive permissions.
- Production frontend defaults to same-origin requests. Its build was run with `VITE_SERVER_URL` empty, overriding the preserved local `client/.env.local` setting; the built bundle did not contain that local API value.
- AI model loading requires the configured local weights file and detection results carry session, source participant and frame timestamp metadata. No model weights or specialized laboratory model are included.
- Current verification: backend integration passed; frontend unit tests 8/8 passed; production build passed; Node/Python syntax checks passed. Python AI tests could not run because Python 3.14 lacks pip and Pillow. Lint, trusted TLS, VM, camera, 5G and model inference acceptance remain pending.

## Checkpoint 6 — local verification and AI retry

- Audited the user's existing Windows local ports. Added local `AI_SERVICE_URL` and `VITE_SERVER_URL` entries without replacing existing `.env` contents, and made local development mode explicit.
- Fixed the root launcher's displayed ports to match its actual Vite port and backend `PORT` setting.
- AI sampling now backs off and retries transient unconfigured/unavailable service errors; authorization/request errors stop sampling. The two Windows AI batch launchers default to `ai-service/models/yolo11n.pt` and CPU mode.
- Network metric rows are pruned when their peer leaves. Adaptive profile state no longer advances unless `RTCRtpSender.setParameters()` is accepted; tests cover the sender parameters.
- Frontend unit tests passed 10/10. Production build passed with empty `VITE_SERVER_URL`; a bundle check confirmed same-origin fallback and no embedded local API URL. The updated local launcher started Vite on 5180 and Node on 3101; frontend returned 200 and `/health` returned `ok`.
- Optional AI service remains stopped because this environment has no Python dependencies or model weights. No camera, multi-physical-device, actual encoder behavior, 5G, or MEC runtime acceptance was performed.
