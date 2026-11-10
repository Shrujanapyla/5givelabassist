# Windows local testing guide

This guide uses the current local configuration: React/Vite at `http://localhost:5180`, Node/Socket.IO at port `3101`, and optional FastAPI at `http://127.0.0.1:8000`. The existing `server/.env` keeps its current port/origin settings; this continuation added only `NODE_ENV=development` and `AI_SERVICE_URL=http://127.0.0.1:8000`. The ignored `client/.env.local` points the browser API and Socket.IO client to `http://localhost:3101`.

The project data directory and user database are not reset by these commands.

## 1. Check Node and current listeners

Open PowerShell. The workspace has Node 22.23.4 installed here; prepend it to `PATH` for this terminal so the current version-manager shim does not select a missing version:

```powershell
$nodeHome = 'C:\Users\shruj\AppData\Local\Author Software\nvm\installs\v22.23.4'
$env:Path = "$nodeHome;$env:Path"
& "$nodeHome\node.exe" --version
```

The first command should print `v22.23.4`. Check ports without stopping anything:

```powershell
$ports = 5180, 3101, 8000
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  ForEach-Object {
    $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [pscustomobject]@{ Port = $_.LocalPort; PID = $_.OwningProcess; Process = $process.ProcessName }
  } | Format-Table -AutoSize
```

No rows means the services are stopped. If a port is occupied, identify that process before choosing a different port; do not kill an unknown process.

## 2. Start the application

The root launcher starts both the backend and Vite on the configured local ports. In PowerShell, from the project root:

```powershell
Set-Location 'C:\Users\shruj\OneDrive\Documents\5G_Live_Lab_Assist_2.0'
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" start
```

Keep this terminal open. It should report frontend port `5180` and backend health port `3101`. Press **Ctrl+C** in this terminal to stop both services.

If you prefer separate terminals, use the same `$nodeHome` and `PATH` setup in each:

```powershell
# Backend terminal, from the project root
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" --prefix server start
```

```powershell
# Frontend terminal, from the project root
& "$nodeHome\node.exe" "$nodeHome\node_modules\npm\bin\npm-cli.js" --prefix client run dev -- --host 0.0.0.0 --port 5180 --strictPort
```

The backend loads `server/.env` at process startup. Vite loads `client/.env.local` at startup. Restart the backend after changing `AI_SERVICE_URL`, and restart Vite after changing `VITE_SERVER_URL`.

## 3. Check the backend and frontend

In a second PowerShell window:

```powershell
Invoke-RestMethod 'http://localhost:3101/health' | ConvertTo-Json -Depth 4
```

Expected JSON includes `"status": "ok"` and `"service": "5g-live-lab-assist"`. Open **http://localhost:5180** in the browser. If the registration/login screen loads but requests fail, check the browser console and verify that `client/.env.local` contains `VITE_SERVER_URL=http://localhost:3101` and that `server/.env` allows the localhost frontend origin.

The current processes run in development mode. The production bundle is a separate Nginx deployment build; it is not the Vite development server.

## 4. Optional AI service

### Configuration and current availability

- `server/app.js` reads `AI_SERVICE_URL` from `process.env`.
- `server/index.js` loads `server/.env` once when the Node process starts.
- The local URL is `http://127.0.0.1:8000`; both `START_AI.bat` and `ai-service/start-ai.bat` use that host and port.
- The Node proxy calls only `POST /detect`. It does **not** call the AI health endpoint before inference.
- FastAPI exposes `GET /health`, which confirms the service process is up. It does not load the model or prove that weights are present.
- This workspace has no `ai-service/.venv`, no installed Pillow/FastAPI/Ultralytics packages, and no `.pt` model weights. AI inference cannot run until those optional dependencies and approved weights are installed.
- The current panel now retries transient service/configuration failures with backoff while AI remains enabled. Invalid requests or expired/unauthorized sessions stop sampling and require a sign-in or request correction.

`AI_SERVICE_URL=http://127.0.0.1:8000` has been added to the local `server/.env`. Restart the backend for it to take effect. To prepare the optional Python environment only when you intend to use AI:

```powershell
Set-Location 'C:\Users\shruj\OneDrive\Documents\5G_Live_Lab_Assist_2.0\ai-service'
py -0p
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Package installation can download a large CPU inference stack. It was not run during this task. If the package index reports that a dependency has no compatible build for your Python version, use an installed Python version supported by all packages in `requirements.txt` and recreate the optional virtual environment with that interpreter.

Get the small generic COCO model weights from an approved source; no model file is included and no download was performed. Place the file at `ai-service\models\yolo11n.pt`, then in the AI terminal set:

```powershell
New-Item -ItemType Directory -Force .\models | Out-Null
Copy-Item 'C:\path\provided\by\your\approved\source\yolo11n.pt' '.\models\yolo11n.pt'
$env:YOLO_MODEL = (Resolve-Path '.\models\yolo11n.pt').Path
$env:AI_CONFIDENCE = '0.35'
$env:AI_DEVICE = 'cpu'
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

The model path must point to an existing local file. The service will return an unavailable error if weights are missing; it does not download weights at startup.

Both `START_AI.bat` at the project root and `ai-service\start-ai.bat` use `ai-service\models\yolo11n.pt` as the default weights path and start Uvicorn on port 8000. They automatically install Python dependencies if `.venv` does not exist, so use them only when you intend that installation. The PowerShell command below starts the already-prepared venv directly.

In another PowerShell window, check FastAPI:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/health' | ConvertTo-Json -Depth 4
```

Expected `status` is `ok`. To exercise inference directly after weights and dependencies are installed, generate a small test PNG and call FastAPI:

```powershell
Add-Type -AssemblyName System.Drawing
$samplePath = Join-Path $env:TEMP '5g-live-lab-ai-smoke.png'
$bitmap = [System.Drawing.Bitmap]::new(320, 240)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.FillRectangle([System.Drawing.Brushes]::Blue, 80, 50, 120, 100)
$bitmap.Save($samplePath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$imageData = [Convert]::ToBase64String([IO.File]::ReadAllBytes($samplePath))
$body = @{ image = "data:image/png;base64,$imageData" } | ConvertTo-Json -Compress
Invoke-RestMethod 'http://127.0.0.1:8000/detect' -Method Post -ContentType 'application/json' -Body $body |
  Select-Object inferenceMs, imageWidth, imageHeight, detections | Format-List
Remove-Item -LiteralPath $samplePath
```

An empty detection array is still a successful inference. The browser AI flow additionally requires a signed-in professor, an active session, and a selected student video. To clear the current “AI service is not configured” state, restart the backend after the local `AI_SERVICE_URL` line is set, start FastAPI after installing dependencies/weights, then start AI sampling again if the panel was already open. Transient errors now retry automatically.

## 5. Register and authenticate

1. In the browser at `http://localhost:5180`, select **Register device**.
2. Create one professor account and one student account with different email addresses. Use a password of 10–72 UTF-8 bytes and the corresponding local development enrollment key configured/documented for this project. Do not use these local keys in production.
3. Each browser profile registers its own device ID. Sign out and sign back in using that same profile to verify login.
4. Use **Sign out** to verify the logout flow.

The existing `server/data` directory/database is preserved. If an account already exists, sign in rather than registering it again. Do not delete or recreate the database to reset a test.

## 6. Test the lab session on one laptop

For two roles, use two isolated browser profiles, such as a normal Chrome profile and a separate Edge profile. Register/login as professor in one and student in the other. Do not use two tabs in the same profile because they share local storage/session state.

1. In the professor browser, select **Create session** and copy the displayed session code.
2. In the student browser, enter that code and select **Join session**.
3. Allow camera and microphone access on `localhost`. Confirm the student camera preview and the professor’s student video tile.
4. Draw an annotation over the live stream from the professor view. Confirm it appears in the other participant view. Clear it and confirm both sides clear.
5. Use the ROI selection/capture controls over the video. Confirm the ROI appears in the shared snapshots workspace.
6. Add a second ROI or snapshot, annotate a snapshot, and check its history/version controls. Confirm both profiles see shared updates.
7. On the student dashboard, choose High/Medium/Low under **Fallback profile** and select **Apply profile**. A success notice means the browser accepted `RTCRtpSender.setParameters`; unsupported browsers show a fallback notice. The unit test checks the parameters passed to a sender, but actual encoder behavior still needs a live browser call.
8. Turn on **Adaptive video**. Sustained poor stats trigger a lower profile after three samples plus cooldown; sustained good stats recover one profile after eight samples plus cooldown. A normal localhost call may stay at High because its network is good. Do not claim degradation/recovery without authorized network impairment and observing the sender during a real call.
9. Start optional AI analysis from the professor view after the AI service health check succeeds. Confirm detections/boxes appear; select **Capture suggested ROI** to verify that detection cropping reaches the existing shared workspace.
10. Close the student browser or sign it out, then reconnect and rejoin using the same code. Confirm the participant tile and its network card disappear on leave and return on rejoin.

One laptop can verify the basic two-role flow, signaling, UI, and localhost media if the browser and camera permit two simultaneous captures. The OS may make a single camera exclusive to one browser. Three simultaneous student feeds, independent camera/microphone behavior, and realistic network adaptation are better validated with additional physical devices. A real 5G radio/access path requires a 5G-connected device and network; localhost testing does not validate 5G or MEC routing.

## 7. Security checks

Run these snippets in the browser DevTools Console for the indicated profile. They print only HTTP status codes and do not print tokens.

**No token:**

```javascript
const noAuth = await fetch('/api/sessions', { method: 'POST' });
console.log(noAuth.status); // Expected: 401
```

**Wrong role:** while signed in as a student:

```javascript
const studentToken = sessionStorage.getItem('5g-live-lab-token');
const denied = await fetch('/api/sessions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${studentToken}` },
});
console.log(denied.status); // Expected: 403
```

**Invalid enrollment key:** use **Register device** with a deliberately incorrect key. Expected: registration is denied with HTTP 403; no account is created.

**Session isolation:** in a profile that is not a member of a known session, run:

```javascript
const outsiderToken = sessionStorage.getItem('5g-live-lab-token');
const otherSessionCode = 'PASTE_A_SESSION_CODE_FROM_ANOTHER_TEST_PROFILE';
const isolated = await fetch(`/api/sessions/${otherSessionCode}/snapshots`, {
  headers: { Authorization: `Bearer ${outsiderToken}` },
});
console.log(isolated.status); // Expected: 404
```

**Logout revocation:** while signed in, use a dedicated test profile and run:

```javascript
const logoutToken = sessionStorage.getItem('5g-live-lab-token');
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: { Authorization: `Bearer ${logoutToken}` },
});
const revoked = await fetch('/api/auth/me', {
  headers: { Authorization: `Bearer ${logoutToken}` },
});
console.log(revoked.status); // Expected: 401
```

The UI in that profile may now need a refresh/sign-in because the token was revoked directly. Tokens expire after 12 hours; a timed expiry test was not run. Existing backend integration tests cover authentication, roles, capacity, signaling, session isolation, audit secrecy, health, and restart persistence.

## 8. Current verification limits

Code/unit checks cannot prove camera hardware, multiple simultaneous devices, browser codec adaptation, AI inference without local weights, or 5G/MEC behavior. Those are separate runtime acceptance tests. Deployment to the university VM additionally requires its hostname, trusted TLS certificate, firewall rules, Linux service account, persistent storage, and administrator approval.

## 9. MEC monitoring and benchmark checks

The signed-in dashboard probes `/api/mec/probe` on the selected 3, 5, or 10 second interval. Every sixth successful probe it transfers a 64 KiB request and response for measured throughput. Payloads stay in memory and are capped server-side. Probe/API response time is browser-observed HTTP duration, separate from WebRTC peer stats. These are local-path measurements until the browser runs on a device connected to the university MEC network.

The professor-only benchmark requires an active session and a PNG/JPEG/WebP sample image no larger than 750 KiB. It makes 3, 5, or 10 runs against the configured MEC `POST /detect` inference endpoint. Browser total response, Node-to-processor request time, and processor-reported inference time are displayed separately. Configure `AI_SERVICE_URL` in `server/.env` and start the inference service to enable measurements. The local environment may have the URL configured while the service itself is offline; in that case the UI reports the unavailable state or failed samples.

To test monitoring, sign in, observe RTT/availability, wait for a periodic transfer, then pause/resume and change intervals. To inspect benchmark configuration, sign in as a professor, join/create a session, and view the benchmark section. Actual inference benchmarking requires the optional AI dependencies and approved local model weights. The selected image is explicitly submitted to the configured MEC inference service; laboratory video is never automatically submitted.

At desktop and phone widths, tab through navigation and test interval/pause, benchmark file/sample/run/reset, and AI adaptive/manual controls. Build and focused tests are listed in the final implementation report.
