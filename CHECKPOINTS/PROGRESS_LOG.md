# Progress log

| Checkpoint | Work | Evidence / state |
|---|---|---|
| 1 | Audit baseline and Claude handoff | Module 1 excluded; Claude transcript did not contain its private working files, so implementation continued from the known-good repository and guide. |
| 2 | Reconstruct Modules 2–6; add auth, metrics, adaptation, AI sampling, three-student sessions, TLS capability and one-command launcher | Backend integration passed with test-only hash adapter; 6 frontend unit tests passed; 2 Python image tests passed; JS syntax checks passed; temporary-cert HTTPS smoke test passed. |
| 3 | Tighten adaptation and sessions; add student camera/connection status tiles; secure invite/password handling; final checkpoint | 7 frontend unit tests and 2 Python tests pass; backend integration passes with temporary test-only bcryptjs API adapter; 20 client JS/JSX files transpile and local imports resolve. Windows lint/build and hardware/5G/real-model acceptance still required. |
| 4 | Improve sender-side telemetry feedback and AI image validation; make optional AI test runner resumable | Frontend unit tests 8/8; Python AI input tests 3/3; all 20 client JS/JSX files transpile and relative imports resolve. Sender-side remote-inbound feedback and 12 MP image guard added. |
| 5 | Prepare Linux MEC deployment; persist session/snapshot data; harden production secrets; preserve same-origin production builds | Backend integration passed with restart persistence and production secret checks; frontend unit tests 8/8 and Vite production build passed. AI tests unavailable because Python lacks pip/Pillow. VM, DNS/TLS, camera, real 5G and model acceptance remain pending. |
| 6 | Verify Windows local configuration; fix launcher port reporting, peer metric cleanup, sender profile confirmation, and AI retry; add local testing guide | Frontend unit tests 10/10; production build and same-origin bundle check passed. Local Vite returned 200 and backend health returned OK on configured ports. AI dependencies/weights and physical runtime acceptance remain pending. |

Last updated: 2026-11-10

## Current restart point

Use `docs/WINDOWS_LOCAL_TESTING.md` for the two-browser local demonstration. The next optional local AI step requires installing Python dependencies and approved model weights. University deployment still requires the administrator's hostname, trusted TLS certificate, service account, and firewall setup; real camera/5G acceptance remains pending.

| 7 | Final project verification, experiment/demo documentation, and clean reproducibility package | npm run verify:all passed core tests/build; 14 frontend tests passed; lint exited 0 with existing warnings; optional AI test step skipped because FastAPI/Pillow are absent. Local frontend returned 200 and backend health returned ok. AI process unavailable. Created five requested guides/README and checked the 86-file source ZIP excludes private/generated files. Actual physical devices, 5G/MEC deployment, AI inference and cloud benchmark remain unverified. |
| 8 | Removed cloud benchmark dependency; prepared Git ignore rules | Removed cloud endpoint settings and paired UI/API flow; the professor benchmark now measures the configured MEC inference endpoint only. Backend integration, 14 frontend unit tests, lint, and production build passed; optional AI verification skipped because FastAPI/Pillow are absent. Added ignores for reproducibility ZIPs and edge/deployment staging artifacts. This workspace has no commits or Git remote, so nothing has been committed or pushed. |

Last updated: 2026-11-10

## Current restart point

Use docs/LOCAL_EXECUTION_GUIDE.md for Windows startup, docs/EXPERIMENT_EXECUTION_GUIDE.md for the test flow, and docs/DEMO_VIDEO_GUIDE.md for recording. College MEC/5G access, physical-device tests, and optional AI/model setup remain acceptance tasks; IP-camera/MediaMTX is not implemented.
